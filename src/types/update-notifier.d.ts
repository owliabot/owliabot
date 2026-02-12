declare module "update-notifier" {
  interface Package {
    name: string;
    version: string;
  }

  interface Settings {
    pkg: Package;
    updateCheckInterval?: number;
  }

  interface NotifyOptions {
    message?: string;
    defer?: boolean;
    isGlobal?: boolean;
  }

  interface UpdateInfo {
    latest: string;
    current: string;
    type: string;
    name: string;
  }

  interface UpdateNotifier {
    update?: UpdateInfo;
    notify(options?: NotifyOptions): void;
  }

  export default function updateNotifier(settings: Settings): UpdateNotifier;
}
