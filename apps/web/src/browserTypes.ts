export interface BrowserFileSystemFileHandle {
  kind: "file";
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<BrowserFileSystemWritableFileStream>;
}

export interface BrowserFileSystemWritableFileStream {
  write(data: string): Promise<void>;
  close(): Promise<void>;
}

export interface BrowserFileSystemDirectoryHandle {
  kind: "directory";
  name: string;
  values(): AsyncIterable<BrowserFileSystemDirectoryHandle | BrowserFileSystemFileHandle>;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<BrowserFileSystemDirectoryHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<BrowserFileSystemFileHandle>;
}

export interface DirectoryPickerWindow extends Window {
  showDirectoryPicker?: (options?: { mode?: "read" | "readwrite" }) => Promise<BrowserFileSystemDirectoryHandle>;
}
