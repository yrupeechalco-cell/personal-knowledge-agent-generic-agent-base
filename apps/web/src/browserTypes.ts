export interface BrowserFileSystemFileHandle {
  kind: "file";
  name: string;
  getFile(): Promise<File>;
}

export interface BrowserFileSystemDirectoryHandle {
  kind: "directory";
  name: string;
  values(): AsyncIterable<BrowserFileSystemDirectoryHandle | BrowserFileSystemFileHandle>;
}

export interface DirectoryPickerWindow extends Window {
  showDirectoryPicker?: () => Promise<BrowserFileSystemDirectoryHandle>;
}
