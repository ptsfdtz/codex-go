export interface ErrorPresentation {
  title: string;
  detail: string;
  solution?: string;
  install: boolean;
  retry: boolean;
}

export function informationNotice(title: string, detail: string): ErrorPresentation {
  return { title, detail, install: false, retry: false };
}

export function errorText(error: ErrorPresentation): string {
  return [error.title, error.detail, error.solution].filter(Boolean).join('\n');
}

function workspaceAccessError(): ErrorPresentation {
  return {
    title: '项目访问未授权',
    detail: 'AgentDeck 无法访问当前工作区，路径可能已移动、删除或撤销授权。',
    solution: '在 Windows 管理窗重新同步工作区；若路径已变化，请重新选择并授权正确的项目目录。',
    install: false,
    retry: true,
  };
}

export function presentDesktopError(code?: string | null, raw?: unknown): ErrorPresentation {
  const message = typeof raw === 'string' ? raw : raw instanceof Error ? raw.message : '';
  const normalizedCode = (
    code ??
    message.match(/\b([A-Z][A-Z0-9_]{2,})\s*:/)?.[1] ??
    ''
  ).toUpperCase();
  const lower = message.toLowerCase();

  if (/mxc launcher|createprocessinsandbox/.test(lower)) {
    return {
      title: 'Windows 隔离环境未能启动',
      detail:
        'Codex 创建任务时，Windows 无法启动 MXC 沙箱子进程。系统返回“找不到路径”（错误码 3）；现有信息无法确定具体缺失的文件或目录。',
      solution:
        '先重新检测并重试。若再次出现，请修复或更新 AgentDeck 的隔离组件，并检查安全软件是否隔离了相关组件。不要通过关闭隔离保护来绕过。',
      install: false,
      retry: true,
    };
  }

  switch (normalizedCode) {
    case 'SYNC_CONFLICT':
    case 'SYNC_LIMIT':
    case 'THREAD_SYNC_FAILED':
      return {
        title: '会话同步尚未完成',
        detail: '会话索引暂时无法完成核对，已保留上次成功同步的会话记录。',
        solution: '等待当前会话操作完成后重新同步；若持续失败，请更新 AgentDeck 并重新检测。',
        install: false,
        retry: true,
      };
    case 'LOW_INTEGRITY_HOST':
      return {
        title: '程序文件继承了低完整性安全标签',
        detail:
          'Windows 将 AgentDeck 及其子进程限制为低完整性，无法启动 MXC 或正常访问凭据；更换终端仍会失败。',
        solution:
          '关闭当前窗口，将 AgentDeck 便携 ZIP 用资源管理器解压到普通用户目录（例如下载目录下的新文件夹），再启动其中的 AgentDeck.exe。不要直接运行受限工作区里的 EXE。',
        install: false,
        retry: false,
      };
    case 'SANDBOX_EXECUTOR_UNAVAILABLE':
      return {
        title: '当前启动环境无法运行 Windows 隔离',
        detail: 'Codex 已启动，但当前执行环境不支持 MXC，服务未能通过隔离检查。',
        solution:
          '检查程序文件是否带有低完整性标签；请使用在普通目录安装或解压的发行包。若仍失败，再检查 Windows 与 Codex 的 MXC 支持。',
        install: false,
        retry: true,
      };
    case 'DATA_DIRECTORY_ERROR':
      return {
        title: '本机数据目录不可用',
        detail: 'AgentDeck 无法创建或保护服务数据目录。',
        solution:
          '从当前 Windows 用户的普通终端启动，并检查数据目录的写入权限及 whoami.exe、icacls.exe 是否可用。',
        install: false,
        retry: true,
      };
    case 'IO_ERROR':
      return {
        title: '本机文件或进程操作失败',
        detail: '服务无法访问所需文件或创建子进程。',
        solution:
          '从普通 Windows Terminal 重新启动，检查数据目录和临时目录权限，以及安装组件是否完整。',
        install: false,
        retry: true,
      };
    case 'CONFLICT':
    case 'PORT_UNAVAILABLE':
      return {
        title: '本机服务资源被占用',
        detail: '服务数据目录或监听端口当前不可用，可能已有另一个 AgentDeck 实例运行。',
        solution:
          '从旧窗口的托盘菜单选择“停止并退出”，再重新检测；若仍失败，请检查端口占用和监听地址。',
        install: false,
        retry: true,
      };
    case 'DATABASE_ERROR':
    case 'SECRET_STORE_ERROR':
      return {
        title: '本机服务数据无法读取',
        detail: '数据库或 Windows 保护的凭据无法访问。',
        solution:
          '使用原 Windows 用户启动，并检查数据目录权限；请保留原数据，不要删除数据库或凭据文件。',
        install: false,
        retry: true,
      };
    case 'UPSTREAM_VERSION_UNSUPPORTED':
      return {
        title: 'Codex CLI 版本不兼容',
        detail:
          '当前 Codex CLI 的 App Server 协议版本尚未通过 AgentDeck 验证，因此服务已停止，避免错误处理会话或审批。',
        solution:
          '安装经验证的 AgentDeck 兼容版，或更新 AgentDeck 以支持当前 CLI。兼容版会并行安装，不会替换全局 CLI。',
        install: true,
        retry: true,
      };
    case 'CODEX_CLI_NOT_FOUND':
      return {
        title: '找不到 Codex CLI',
        detail: 'AgentDeck 无法定位可用的 Codex CLI。',
        solution: '安装 AgentDeck 兼容版后重新检测；该副本不需要修改系统 PATH。',
        install: true,
        retry: true,
      };
    case 'UPSTREAM_PROTOCOL_ERROR':
      return {
        title: 'Codex 协议响应不兼容',
        detail: 'Codex 返回的数据结构与 AgentDeck 支持的协议不匹配，因此服务已停止。',
        solution: '安装经验证的兼容版，或更新 AgentDeck 后重新检测。',
        install: true,
        retry: true,
      };
    case 'SANDBOX_UNAVAILABLE':
    case 'SANDBOX_UNVERIFIED':
      return {
        title: 'Windows 隔离环境检查未通过',
        detail: 'AgentDeck 无法确认工作区访问边界，因此不会启动任务。',
        solution: '检查并修复 Windows 隔离组件后重新检测。不要关闭隔离保护来绕过检查。',
        install: false,
        retry: true,
      };
    case 'UNSAFE_UPSTREAM_CONFIG':
      return {
        title: 'Codex 安全配置不兼容',
        detail: '当前 Codex 文件访问、网络或扩展配置与 AgentDeck 的隔离要求冲突。',
        solution: '检查 Codex 安全配置并移除冲突项，然后重新检测。',
        install: false,
        retry: true,
      };
    case 'SERVICE_DISCONNECTED':
      return {
        title: 'AgentDeck 本机服务已断开',
        detail: '本机服务连接中断，正在进行的任务结果需要重新核对。',
        solution: '重新检测以重启本机服务；重试任务前先确认 Codex 中的实际状态。',
        install: false,
        retry: true,
      };
    case 'CONFIG_ERROR':
      return {
        title: 'AgentDeck 启动配置不完整',
        detail: '本机配置或 Codex CLI 安装未通过检查。',
        solution: '修复 Codex CLI 安装和 AgentDeck 配置后重新检测。',
        install: false,
        retry: true,
      };
    case 'WORKSPACE_FORBIDDEN':
      return workspaceAccessError();
  }

  if (
    /工作区路径.{0,20}(失效|不存在|找不到)|(?:工作区|项目).{0,20}(未授权|已失效|不存在)|(?:工作区|项目|路径).{0,20}重新授权/i.test(
      message,
    )
  ) {
    return workspaceAccessError();
  }

  if (/certificate|tls|ssl/.test(lower)) {
    return {
      title: '安全连接校验失败',
      detail: '连接的证书校验未通过，数据未发送。',
      solution: '检查系统时间和目标设备证书；不要忽略证书警告。',
      install: false,
      retry: true,
    };
  }
  if (/timed? ?out|timeout|econn|network|连接.*断开/.test(lower)) {
    return {
      title: '连接暂时不可用',
      detail: '网络连接中断或等待超时，操作结果可能未知。',
      solution: '检查网络并重新连接；重试任务前先核对会话状态。',
      install: false,
      retry: true,
    };
  }

  return {
    title: '操作未完成',
    detail: 'AgentDeck 遇到未分类的错误，原始诊断信息已隐藏。',
    solution: '检查连接和运行环境后重试；若涉及任务提交，请先核对会话状态。',
    install: false,
    retry: true,
  };
}

export function presentThrownError(value: unknown): ErrorPresentation {
  return presentDesktopError(null, value);
}
