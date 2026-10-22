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
