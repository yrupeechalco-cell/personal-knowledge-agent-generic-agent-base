use super::{AgentAttachment, ModelRequest, ModelTurnResponse};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    env,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::mpsc::{self, Receiver},
    thread,
    time::{Duration, Instant},
};

const STARTUP_TIMEOUT: Duration = Duration::from_secs(30);
const TURN_TIMEOUT: Duration = Duration::from_secs(180);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexModel {
    id: String,
    label: String,
    description: String,
    is_default: bool,
    supports_images: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexStatus {
    available: bool,
    authenticated: bool,
    auth_mode: Option<String>,
    plan_type: Option<String>,
    models: Vec<CodexModel>,
    error: Option<String>,
}

pub(crate) fn codex_status_blocking() -> Result<CodexStatus, String> {
    let executable = match locate_codex_executable() {
        Ok(path) => path,
        Err(error) => {
            return Ok(CodexStatus {
                available: false,
                authenticated: false,
                auth_mode: None,
                plan_type: None,
                models: Vec::new(),
                error: Some(error),
            });
        }
    };
    let mut server = AppServer::start(&executable)?;
    let account = server.request(
        1,
        "account/read",
        json!({ "refreshToken": false }),
        STARTUP_TIMEOUT,
    )?;
    let models = server.request(
        2,
        "model/list",
        json!({ "limit": 20, "includeHidden": false }),
        STARTUP_TIMEOUT,
    )?;
    let account_value = account
        .get("result")
        .and_then(|result| result.get("account"));
    let auth_mode = account_value
        .and_then(|account| account.get("type"))
        .and_then(Value::as_str)
        .map(str::to_string);
    let plan_type = account_value
        .and_then(|account| account.get("planType"))
        .and_then(Value::as_str)
        .map(str::to_string);
    Ok(CodexStatus {
        available: true,
        authenticated: account_value.is_some_and(|account| !account.is_null()),
        auth_mode,
        plan_type,
        models: parse_models(&models),
        error: None,
    })
}

pub(crate) fn codex_completion_blocking(
    request: ModelRequest,
) -> Result<ModelTurnResponse, String> {
    let executable = locate_codex_executable()?;
    let mut server = AppServer::start(&executable)?;
    let models = server.request(
        1,
        "model/list",
        json!({ "limit": 20, "includeHidden": false }),
        STARTUP_TIMEOUT,
    )?;
    let selected_model = select_model(request.model.as_deref(), &models)?;
    let cwd = safe_working_directory(request.cwd.as_deref());
    let base_instructions = format!(
        "{}\n\nThis Codex integration is currently conversation-only. Answer the user directly. Do not modify files, run destructive commands, or claim that a file operation succeeded.",
        request.system
    );
    let thread = server.request(
        2,
        "thread/start",
        json!({
            "model": selected_model,
            "cwd": cwd,
            "approvalPolicy": "never",
            "sandbox": "read-only",
            "baseInstructions": base_instructions,
            "ephemeral": true,
            "experimentalRawEvents": false,
            "persistExtendedHistory": false
        }),
        STARTUP_TIMEOUT,
    )?;
    let thread_id = result_field(&thread, &["thread", "id"])?
        .as_str()
        .ok_or_else(|| "Codex thread/start returned an invalid thread id".to_string())?
        .to_string();
    let input = build_turn_input(&request);
    let effort = normalize_effort(request.reasoning_effort.as_deref());
    let turn = server.request_with_pending(
        3,
        "turn/start",
        json!({
            "threadId": thread_id,
            "input": input,
            "model": selected_model,
            "effort": effort
        }),
        STARTUP_TIMEOUT,
    )?;
    if turn.response.get("result").is_none() {
        return Err(rpc_error(&turn.response));
    }

    let mut content = String::new();
    for message in turn.pending {
        collect_agent_delta(&message, &mut content);
    }
    let deadline = Instant::now() + TURN_TIMEOUT;
    loop {
        let message = server.receive(deadline)?;
        collect_agent_delta(&message, &mut content);
        if message.get("method").and_then(Value::as_str) != Some("turn/completed") {
            continue;
        }
        let status = message
            .pointer("/params/turn/status")
            .and_then(Value::as_str)
            .unwrap_or("failed");
        if status != "completed" {
            let detail = message
                .pointer("/params/turn/error/message")
                .and_then(Value::as_str)
                .unwrap_or("Codex turn failed");
            return Err(detail.to_string());
        }
        break;
    }

    if content.trim().is_empty() {
        return Err("Codex completed the turn without a text response".to_string());
    }
    Ok(ModelTurnResponse {
        content,
        reasoning_content: None,
        tool_calls: Vec::new(),
    })
}

struct PendingResponse {
    response: Value,
    pending: Vec<Value>,
}

struct AppServer {
    child: Child,
    stdin: ChildStdin,
    receiver: Receiver<Result<Value, String>>,
}

impl AppServer {
    fn start(executable: &Path) -> Result<Self, String> {
        let mut command = Command::new(executable);
        command
            .args([
                "app-server",
                "-c",
                "service_tier=\"fast\"",
                "-c",
                "mcp_servers={}",
            ])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let mut child = command
            .spawn()
            .map_err(|error| format!("无法启动 Codex App Server：{error}"))?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Codex App Server stdin unavailable".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Codex App Server stdout unavailable".to_string())?;
        let (sender, receiver) = mpsc::channel();
        thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let result = line.map_err(|error| error.to_string()).and_then(|line| {
                    serde_json::from_str::<Value>(&line).map_err(|error| error.to_string())
                });
                if sender.send(result).is_err() {
                    break;
                }
            }
        });
        let mut server = Self {
            child,
            stdin,
            receiver,
        };
        let initialized = server.request(
            0,
            "initialize",
            json!({
                "clientInfo": {
                    "name": "personal_knowledge_agent",
                    "title": "Personal Knowledge Agent",
                    "version": env!("CARGO_PKG_VERSION")
                }
            }),
            STARTUP_TIMEOUT,
        )?;
        if initialized.get("result").is_none() {
            return Err(rpc_error(&initialized));
        }
        server.send(json!({ "method": "initialized", "params": {} }))?;
        Ok(server)
    }

    fn send(&mut self, message: Value) -> Result<(), String> {
        serde_json::to_writer(&mut self.stdin, &message).map_err(|error| error.to_string())?;
        self.stdin
            .write_all(b"\n")
            .map_err(|error| error.to_string())?;
        self.stdin.flush().map_err(|error| error.to_string())
    }

    fn request(
        &mut self,
        id: u64,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Value, String> {
        Ok(self
            .request_with_pending(id, method, params, timeout)?
            .response)
    }

    fn request_with_pending(
        &mut self,
        id: u64,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<PendingResponse, String> {
        self.send(json!({ "method": method, "id": id, "params": params }))?;
        let deadline = Instant::now() + timeout;
        let mut pending = Vec::new();
        loop {
            let message = self.receive(deadline)?;
            if message.get("id").and_then(Value::as_u64) == Some(id) {
                if message.get("error").is_some() {
                    return Err(rpc_error(&message));
                }
                return Ok(PendingResponse {
                    response: message,
                    pending,
                });
            }
            pending.push(message);
        }
    }

    fn receive(&self, deadline: Instant) -> Result<Value, String> {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err("Codex request timed out".to_string());
        }
        self.receiver
            .recv_timeout(remaining)
            .map_err(|_| "Codex request timed out".to_string())?
    }
}

impl Drop for AppServer {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn parse_models(response: &Value) -> Vec<CodexModel> {
    response
        .pointer("/result/data")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|model| {
            let id = model.get("id")?.as_str()?.to_string();
            let modalities = model
                .get("inputModalities")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            Some(CodexModel {
                label: model
                    .get("displayName")
                    .and_then(Value::as_str)
                    .unwrap_or(&id)
                    .to_string(),
                description: model
                    .get("description")
                    .and_then(Value::as_str)
                    .unwrap_or("Codex model")
                    .to_string(),
                is_default: model
                    .get("isDefault")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                supports_images: modalities
                    .iter()
                    .any(|modality| modality.as_str() == Some("image")),
                id,
            })
        })
        .collect()
}

fn select_model(requested: Option<&str>, response: &Value) -> Result<String, String> {
    let requested = requested
        .and_then(|model| model.strip_prefix("codex:"))
        .unwrap_or("gpt-5.4");
    let models = parse_models(response);
    if models.iter().any(|model| model.id == requested) {
        return Ok(requested.to_string());
    }
    if let Some(model) = models.iter().find(|model| model.id == "gpt-5.4") {
        return Ok(model.id.clone());
    }
    models
        .iter()
        .find(|model| model.is_default)
        .or_else(|| models.first())
        .map(|model| model.id.clone())
        .ok_or_else(|| "Codex did not report any available models".to_string())
}

fn build_turn_input(request: &ModelRequest) -> Vec<Value> {
    let transcript = request
        .messages
        .iter()
        .filter(|message| message.role != "tool")
        .map(|message| format!("{}: {}", message.role, message.content))
        .collect::<Vec<_>>()
        .join("\n\n");
    let mut input = vec![json!({
        "type": "text",
        "text": transcript,
        "text_elements": []
    })];
    for attachment in request.attachments.as_deref().unwrap_or_default() {
        if !is_image_attachment(attachment) {
            continue;
        }
        let Some(source_path) = attachment.source_path.as_deref() else {
            continue;
        };
        let path = Path::new(source_path);
        if path.is_file() {
            input.push(json!({
                "type": "localImage",
                "path": path
            }));
        }
    }
    input
}

fn is_image_attachment(attachment: &AgentAttachment) -> bool {
    attachment.kind == "image-ocr"
        || attachment
            .media_type
            .as_deref()
            .is_some_and(|media_type| media_type.starts_with("image/"))
}

fn collect_agent_delta(message: &Value, content: &mut String) {
    if message.get("method").and_then(Value::as_str) == Some("item/agentMessage/delta") {
        if let Some(delta) = message.pointer("/params/delta").and_then(Value::as_str) {
            content.push_str(delta);
        }
    }
}

fn result_field<'a>(response: &'a Value, path: &[&str]) -> Result<&'a Value, String> {
    let mut value = response.get("result").ok_or_else(|| rpc_error(response))?;
    for segment in path {
        value = value
            .get(*segment)
            .ok_or_else(|| format!("Codex response is missing result.{}", path.join(".")))?;
    }
    Ok(value)
}

fn rpc_error(response: &Value) -> String {
    response
        .pointer("/error/message")
        .and_then(Value::as_str)
        .unwrap_or("Codex App Server returned an unknown error")
        .to_string()
}

fn normalize_effort(value: Option<&str>) -> &str {
    match value {
        Some("low") => "low",
        Some("high") => "high",
        _ => "medium",
    }
}

fn safe_working_directory(requested: Option<&str>) -> String {
    requested
        .map(PathBuf::from)
        .filter(|path| path.is_dir())
        .or_else(|| env::var_os("USERPROFILE").map(PathBuf::from))
        .or_else(|| env::current_dir().ok())
        .unwrap_or_else(|| PathBuf::from("."))
        .to_string_lossy()
        .to_string()
}

fn locate_codex_executable() -> Result<PathBuf, String> {
    if let Some(path) = env::var_os("KNOWLEDGE_AGENT_CODEX_BIN").map(PathBuf::from) {
        if path.is_file() {
            return Ok(path);
        }
    }
    let app_data = env::var_os("APPDATA")
        .map(PathBuf::from)
        .ok_or_else(|| "APPDATA is unavailable; cannot locate Codex CLI".to_string())?;
    let candidate = app_data
        .join("npm")
        .join("node_modules")
        .join("@openai")
        .join("codex")
        .join("node_modules")
        .join("@openai")
        .join("codex-win32-x64")
        .join("vendor")
        .join("x86_64-pc-windows-msvc")
        .join("codex")
        .join("codex.exe");
    if candidate.is_file() {
        return Ok(candidate);
    }
    Err("未检测到 Codex CLI。请先安装 Codex，或设置 KNOWLEDGE_AGENT_CODEX_BIN。".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn model_response() -> Value {
        json!({
            "result": {
                "data": [
                    {
                        "id": "gpt-5.3-codex",
                        "displayName": "GPT-5.3 Codex",
                        "description": "Default Codex model",
                        "isDefault": true,
                        "inputModalities": ["text", "image"]
                    },
                    {
                        "id": "gpt-5.4",
                        "displayName": "GPT-5.4",
                        "description": "General model",
                        "isDefault": false,
                        "inputModalities": ["text", "image"]
                    }
                ]
            }
        })
    }

    #[test]
    fn selects_the_requested_codex_model() {
        assert_eq!(
            select_model(Some("codex:gpt-5.3-codex"), &model_response()).unwrap(),
            "gpt-5.3-codex"
        );
    }

    #[test]
    fn falls_back_to_a_known_model() {
        assert_eq!(
            select_model(Some("codex:not-installed"), &model_response()).unwrap(),
            "gpt-5.4"
        );
    }

    #[test]
    #[ignore = "requires a signed-in local Codex and CODEX_LIVE_IMAGE"]
    fn live_image_round_trip_uses_the_production_bridge() {
        let image_path =
            env::var("CODEX_LIVE_IMAGE").expect("CODEX_LIVE_IMAGE must point to a local image");
        let request = ModelRequest {
            system: "Answer briefly and only describe what is visible in the supplied image."
                .to_string(),
            messages: vec![super::super::ModelMessage {
                role: "user".to_string(),
                content: "What kind of application interface is visible?".to_string(),
                tool_call_id: None,
                tool_calls: None,
                reasoning_content: None,
            }],
            model: Some("codex:gpt-5.4".to_string()),
            cwd: None,
            attachments: Some(vec![AgentAttachment {
                id: "live-image".to_string(),
                name: "live-image.png".to_string(),
                kind: "image-ocr".to_string(),
                content: "Image attached for visual inspection.".to_string(),
                size: 0,
                media_type: Some("image/png".to_string()),
                source_path: Some(image_path),
                truncated: false,
                warning: None,
            }]),
            thinking: Some(false),
            reasoning_effort: Some("low".to_string()),
            tools: None,
        };

        let response = codex_completion_blocking(request).expect("Codex image turn should succeed");
        assert!(!response.content.trim().is_empty());
        eprintln!("Codex image response: {}", response.content);
    }
}
