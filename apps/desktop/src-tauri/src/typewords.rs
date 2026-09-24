//! Launch the bundled TypeWords build (or an explicitly selected custom build), on loopback.
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
    Ok(node_directory(&directory))
}

fn node_directory(directory: &Path) -> PathBuf {
    // Node's CLI realpath handling cannot use Rust's Windows verbatim prefix.
    #[cfg(windows)] {
        let value = directory.to_string_lossy();
        if let Some(rest) = value.strip_prefix(r"\\?\UNC\") { return PathBuf::from(format!(r"\\{}", rest)); }
        if let Some(rest) = value.strip_prefix(r"\\?\") { return PathBuf::from(rest); }
    }
    directory.to_path_buf()
}

// Old machines may retain an external folder that does not exist on this computer.
// Missing/corrupt settings and unavailable folders must not block the built-in version.
fn resolve_directory(config: &Path, bundled: &Path) -> Result<PathBuf, String> {
    if let Ok(bytes) = fs::read(config) {
        if let Ok(settings) = serde_json::from_slice::<Settings>(&bytes) {
            if let Ok(directory) = validate_directory(&settings.directory) { return Ok(directory); }
        }
    }
    validate_directory(bundled).map_err(|_| "安装包中的 TypeWords 文件缺失或损坏，请重新安装最新版知识库。".into())
}

fn bundled_paths(app: &tauri::AppHandle) -> Result<(PathBuf, PathBuf), String> {
    let directory = app.path().resource_dir().map_err(|e| e.to_string())?.join("plugins/typewords");
    let runtime = directory.join("runtime/node.exe");
    if !runtime.is_file() { return Err("安装包中的英语学习运行环境缺失，请重新安装最新版知识库，无需另外安装 Node.js。".into()); }
    Ok((directory, node_directory(&runtime)))
}

fn server_command(runtime: &Path, directory: &Path) -> Command {
    let mut command = Command::new(runtime);
    command.arg(directory.join(".output/server/index.mjs")).current_dir(directory)
        .env("NITRO_HOST", "127.0.0.1").env("HOST", "127.0.0.1")
        .env("NITRO_PORT", "5567").env("PORT", "5567")
        .env("NODE_ENV", "production")
        // A machine-wide Node setting must not inject code or change plugin behavior.
        .env_remove("NODE_OPTIONS").env_remove("NODE_PATH")
        .env_remove("NUXT_APP_BASE_URL").env_remove("NITRO_SSL_CERT").env_remove("NITRO_SSL_KEY")
        .stdin(Stdio::null());
    #[cfg(windows)] {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    command
}

// No proxy, redirects or external URLs: an unrelated service must never be killed or embedded.
fn probe(url: &str) -> Result<bool, String> {
    let parsed = reqwest::Url::parse(url).map_err(|e| e.to_string())?;
    let port = parsed.port().ok_or("缺少本机插件端口。")?;
    // Check the TCP listener separately: Windows may delay connection refusal
    // longer than the HTTP timeout. Once connected, HTTP errors remain errors.
    let address = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    match std::net::TcpStream::connect_timeout(&address, Duration::from_millis(500)) {
        Ok(stream) => drop(stream),
        Err(error) if matches!(error.kind(), std::io::ErrorKind::ConnectionRefused | std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock) => return Ok(false),
        Err(error) => return Err(format!("无法检查 TypeWords 本机端口：{error}")),
    }
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
        let (bundled, runtime) = bundled_paths(&app)?;
        let directory = resolve_directory(&path, &bundled)?;
        let log = fs::File::create(path.with_file_name("typewords.log")).map_err(|e| e.to_string())?;
        let mut command = server_command(&runtime, &directory);
        command.stdout(log.try_clone().map_err(|e| e.to_string())?).stderr(log);
        *child = Some(command.spawn().map_err(|e| format!("无法启动内置英语学习运行环境，请重试或重新安装最新版：{e}"))?);
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
pub async fn typewords_use_bundled(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (bundled, _) = bundled_paths(&app)?;
        validate_directory(&bundled)?;
        let state = app.state::<TypeWordsProcess>();
        let mut child = state.0.lock().map_err(|_| "插件状态异常，请重启知识库。".to_string())?;
        if child.is_none() && probe("http://127.0.0.1:5567/words")? {
            return Err("另一个 TypeWords 正在独立运行，请先关闭它，再使用内置版本。".into());
        }
        match fs::remove_file(config_path(&app)?) {
            Ok(()) => {},
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {},
            Err(error) => return Err(error.to_string()),
        }
        stop_child(&mut child);
        // Never delete or migrate WebView/TypeWords learning storage.
        Ok(())
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
            loop {
                let (mut stream, _) = listener.accept().unwrap();
                let mut buffer = [0; 4096];
                if stream.read(&mut buffer).unwrap_or(0) == 0 { continue; }
                write!(stream, "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body).unwrap();
                break;
            }
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

    #[test]
    fn clean_install_and_unavailable_custom_folder_use_bundled_build() {
        let root = std::env::temp_dir().join(format!("typewords-fallback-{}", std::process::id()));
        let bundled = root.join("内置 英语学习");
        fs::create_dir_all(bundled.join(".output/server")).unwrap();
        fs::write(bundled.join("package.json"), r#"{"name":"typewords"}"#).unwrap();
        fs::write(bundled.join(".output/server/index.mjs"), "").unwrap();
        let config = root.join("typewords.json");
        let expected = validate_directory(&bundled).unwrap();
        assert_eq!(resolve_directory(&config, &bundled).unwrap(), expected);
        fs::write(&config, b"broken config").unwrap();
        assert_eq!(resolve_directory(&config, &bundled).unwrap(), expected);
        fs::write(&config, serde_json::to_vec(&Settings { directory: root.join("old-computer") }).unwrap()).unwrap();
        assert_eq!(resolve_directory(&config, &bundled).unwrap(), expected);
        let custom = root.join("custom");
        fs::create_dir_all(custom.join(".output/server")).unwrap();
        fs::write(custom.join("package.json"), r#"{"name":"typewords"}"#).unwrap();
        fs::write(custom.join(".output/server/index.mjs"), "").unwrap();
        fs::write(&config, serde_json::to_vec(&Settings { directory: custom.clone() }).unwrap()).unwrap();
        assert_eq!(resolve_directory(&config, &bundled).unwrap(), validate_directory(&custom).unwrap());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn launches_absolute_runtime_without_path_or_inherited_node_options() {
        let runtime = std::env::temp_dir().join("内置运行环境/node.exe");
        let directory = std::env::temp_dir().join("英语 学习");
        let command = server_command(&runtime, &directory);
        assert_eq!(command.get_program(), runtime.as_os_str());
        assert_eq!(command.get_args().next().unwrap(), directory.join(".output/server/index.mjs").as_os_str());
        assert!(command.get_envs().any(|(key, value)| key == "NODE_OPTIONS" && value.is_none()));
        assert!(command.get_envs().any(|(key, value)| key == "NITRO_HOST" && value == Some(std::ffi::OsStr::new("127.0.0.1"))));
    }

    #[cfg(windows)]
    #[test]
    fn converts_verbatim_paths_for_node_without_changing_chinese_or_spaces() {
        assert_eq!(node_directory(Path::new(r"\\?\C:\中文 文件夹\TypeWords")), PathBuf::from(r"C:\中文 文件夹\TypeWords"));
        assert_eq!(node_directory(Path::new(r"\\?\UNC\server\资料\TypeWords")), PathBuf::from(r"\\server\资料\TypeWords"));
    }
}
