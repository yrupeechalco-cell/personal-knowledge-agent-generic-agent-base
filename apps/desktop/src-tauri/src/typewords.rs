//! Launch only the user's registered TypeWords production build, on loopback.
use serde::{Deserialize, Serialize};
use std::{fs, io::{Read, Write}, path::{Path, PathBuf}, process::{Child, Command, Stdio}, sync::Mutex, time::{Duration, Instant}};
use tauri::Manager;

#[derive(Default)]
pub struct TypeWordsProcess(pub Mutex<Option<Child>>);

#[derive(Serialize, Deserialize)]
struct Settings { directory: PathBuf }

fn config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let directory = app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("plugins");
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    Ok(directory.join("typewords.json"))
}

fn validate_directory(directory: &Path) -> Result<PathBuf, String> {
    let directory = directory.canonicalize().map_err(|_| "TypeWords 文件夹不存在，请重新选择。".to_string())?;
    let package: serde_json::Value = serde_json::from_slice(&fs::read(directory.join("package.json")).map_err(|_| "请选择 TypeWords 根文件夹（含 package.json）。".to_string())?).map_err(|_| "TypeWords package.json 无法读取。".to_string())?;
    if package.get("name").and_then(|v| v.as_str()) != Some("typewords") {
        return Err("所选文件夹不是 TypeWords。".into());
    }
    if !directory.join(".output/server/index.mjs").is_file() {
        return Err("此 TypeWords 目录缺少生产构建 .output/server/index.mjs，请选择已构建的版本。".into());
    }
    Ok(directory)
}

// No proxy, redirects or external URLs: an unrelated service must never be killed or embedded.
fn probe(url: &str) -> Result<bool, String> {
    let client = reqwest::blocking::Client::builder().no_proxy().redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(2)).build().map_err(|e| e.to_string())?;
    let response = match client.get(url).send() {
        Ok(response) => response,
        Err(error) if error.is_connect() => return Ok(false),
        Err(_) => return Err("5567 端口无响应，请检查占用该端口的程序后重试。".into()),
    };
    if !response.status().is_success() { return Err("5567 端口上的服务不是可用的 TypeWords，请检查端口占用。".into()); }
    let mut body = String::new();
    response.take(256 * 1024).read_to_string(&mut body).map_err(|e| e.to_string())?;
    let lower = body.to_lowercase();
    if !lower.contains("typewords") && !lower.contains("type words") {
        return Err("5567 端口已被其他程序占用，未启动 TypeWords，也未关闭该程序。".into());
    }
    Ok(true)
}

fn stop_child(child: &mut Option<Child>) {
    if let Some(mut process) = child.take() {
        let _ = process.kill();
        let _ = process.wait();
    }
}

pub fn shutdown(app: &tauri::AppHandle) {
    let state = app.state::<TypeWordsProcess>();
    if let Ok(mut child) = state.0.lock() { stop_child(&mut child); };
}

#[tauri::command]
pub async fn typewords_start(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<TypeWordsProcess>();
        let mut child = state.0.lock().map_err(|_| "插件状态异常，请重启知识库。".to_string())?;
        if probe("http://127.0.0.1:5567/words")? { return Ok(()); }
        stop_child(&mut child);
        let path = config_path(&app)?;
        let settings: Settings = serde_json::from_slice(&fs::read(&path).map_err(|_| "首次使用请点击“选择 TypeWords 文件夹”；选择一次后会随知识库自动启动。".to_string())?).map_err(|_| "TypeWords 配置无法读取，请重新选择文件夹。".to_string())?;
        let directory = validate_directory(&settings.directory)?;
        let log = fs::File::create(path.with_file_name("typewords.log")).map_err(|e| e.to_string())?;
        let mut command = Command::new("node");
        command.arg(directory.join(".output/server/index.mjs")).current_dir(&directory)
            .env("NITRO_HOST", "127.0.0.1").env("HOST", "127.0.0.1")
            .env("NITRO_PORT", "5567").env("PORT", "5567")
            .stdin(Stdio::null()).stdout(log.try_clone().map_err(|e| e.to_string())?).stderr(log);
        #[cfg(windows)] {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }
        *child = Some(command.spawn().map_err(|e| format!("无法启动 TypeWords，请确认已安装 Node.js 22 并重启知识库：{e}"))?);
        let deadline = Instant::now() + Duration::from_secs(20);
        let result = loop {
            if let Some(process) = child.as_mut() {
                match process.try_wait() {
                    Ok(Some(_)) => break Err("TypeWords 启动后退出，请检查插件日志 typewords.log。".into()),
                    Err(e) => break Err(e.to_string()),
                    Ok(None) => {},
                }
            }
            match probe("http://127.0.0.1:5567/words") {
                Ok(true) => break Ok(()),
                Err(error) => break Err(error),
                Ok(false) => {},
            }
            if Instant::now() >= deadline { break Err("TypeWords 启动超时，请重试并检查插件日志。".into()); }
            std::thread::sleep(Duration::from_millis(300));
        };
        if result.is_err() { stop_child(&mut child); }
        result
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn typewords_select_directory(app: tauri::AppHandle) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(directory) = rfd::FileDialog::new().set_title("选择已构建的 TypeWords 根文件夹").pick_folder() else { return Ok(false); };
        let directory = validate_directory(&directory)?;
        let state = app.state::<TypeWordsProcess>();
        let mut child = state.0.lock().map_err(|_| "插件状态异常，请重启知识库。".to_string())?;
        let path = config_path(&app)?;
        let temporary = path.with_extension("tmp");
        let mut file = fs::File::create(&temporary).map_err(|e| e.to_string())?;
        file.write_all(&serde_json::to_vec(&Settings { directory }).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        drop(file);
        super::replace_file_atomic(&temporary, &path)?;
        stop_child(&mut child);
        Ok(true)
    }).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    fn serve(body: &'static str) -> (String, std::thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/words", listener.local_addr().unwrap());
        let thread = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buffer = [0; 4096];
            let _ = stream.read(&mut buffer);
            write!(stream, "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body).unwrap();
        });
        (url, thread)
    }

    #[test]
    fn verifies_service_and_rejects_unrelated_port() {
        let (url, thread) = serve("<html><title>Type Words</title></html>");
        assert_eq!(probe(&url).unwrap(), true);
        thread.join().unwrap();
        let (url, thread) = serve("<html>Another app</html>");
        assert!(probe(&url).unwrap_err().contains("其他程序"));
        thread.join().unwrap();
        assert!(!probe(&url).unwrap());
    }

    #[test]
    fn requires_typewords_package_and_production_entry() {
        let root = std::env::temp_dir().join(format!("typewords-validation-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("package.json"), r#"{"name":"another-app"}"#).unwrap();
        assert!(validate_directory(&root).unwrap_err().contains("不是 TypeWords"));
        fs::write(root.join("package.json"), r#"{"name":"typewords"}"#).unwrap();
        assert!(validate_directory(&root).unwrap_err().contains("生产构建"));
        fs::create_dir_all(root.join(".output/server")).unwrap();
        fs::write(root.join(".output/server/index.mjs"), "").unwrap();
        assert!(validate_directory(&root).unwrap().is_absolute());
        fs::remove_dir_all(root).unwrap();
    }
}
