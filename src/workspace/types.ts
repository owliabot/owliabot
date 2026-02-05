export interface WorkspaceFiles {
  agents?: string;
  soul?: string;
  identity?: string;
  user?: string;
  heartbeat?: string;
  memory?: string;
  tools?: string;
  bootstrap?: string;
}

export interface WorkspaceLoader {
  load(): Promise<WorkspaceFiles>;
  getFile(name: string): Promise<string | undefined>;
}
