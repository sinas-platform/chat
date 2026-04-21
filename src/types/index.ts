import type { ChatAttachment } from "../lib/files/types";

// Authentication
export interface User {
    id: string;
    email: string;
    is_active: boolean;
    external_auth_provider?: string | null;
    external_auth_id?: string | null;
    created_at: string;
  }
  
  export interface LoginRequest {
    email: string;
  }
  
  export interface LoginResponse {
    message: string;
    session_id: string;
  }
  
  export interface OTPVerifyRequest {
    session_id: string;
    otp_code: string;
  }
  
  export interface OTPVerifyResponse {
    access_token: string;
    refresh_token: string;
    token_type: string;
    expires_in: number;
    user: User;
  }
  
  // Chats
export interface Chat {
    id: string;
    user_id: string;
    user_email?: string;
    agent_id: string | null;
    agent_namespace: string | null;
    agent_name: string | null;
    title: string;
    created_at: string;
    updated_at: string;
    last_message_at?: string | null;
  }
  
  export interface ChatCreate {
    title?: string;
    input?: Record<string, unknown>;
  }
  
export interface ChatWithMessages extends Chat {
    messages: Message[];
    pending_approvals?: PendingApproval[];
  }

export interface PendingApproval {
  tool_call_id: string;
  function_namespace: string;
  function_name: string;
  arguments: Record<string, unknown>;
}
  
  export type MessageContent = string | Array<string | Record<string, unknown>>;

  export interface MessageToolCallFunction {
    name?: string | null;
    arguments?: string | Record<string, unknown> | null;
    tool_call_id?: string | null;
    id?: string | null;
  }

  export interface MessageToolCall {
    id?: string | null;
    type?: string | null;
    description?: string | null;
    function?: MessageToolCallFunction | null;
    tool_call_id?: string | null;
    call_id?: string | null;
  }
  
  export interface Message {
    id: string;
    chat_id: string;
    role: "user" | "assistant" | "system" | "tool";
    content: MessageContent | null;
    tool_calls: MessageToolCall[] | null;
    tool_call_id: string | null;
    name: string | null;
    created_at: string;
  }
  
export interface MessageSendRequest {
    content: MessageContent;
    attachments?: ChatAttachment[];
  }

export interface ApprovalRequiredEvent {
  type: "approval_required";
  tool_call_id: string;
  function_namespace: string;
  function_name: string;
  arguments: Record<string, unknown>;
}

export interface ToolStartEvent {
  type?: "tool_start";
  tool_call_id: string;
  name: string;
  arguments?: string | Record<string, unknown> | null;
  description?: string | null;
}

export interface ToolEndEvent {
  type?: "tool_end";
  tool_call_id: string;
  name?: string | null;
  result?: unknown;
}

export interface ToolApprovalRequest {
  approved: boolean;
}

export interface ToolApprovalResponse {
  status: "approved" | "rejected";
  tool_call_id: string;
  channel_id: string;
  message?: string;
}

export interface PreferenceStateRecord<TValue = unknown> {
  id?: string;
  user_id?: string | null;
  namespace?: string;
  store_id?: string;
  store_namespace?: string;
  store_name?: string;
  key: string;
  value: TValue;
  visibility: string;
  description?: string | null;
  tags?: string[] | null;
  relevance_score?: number | null;
  expires_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface CreatePreferenceStateRequest<TValue = unknown> {
  key: string;
  value: TValue;
  visibility: string;
  description?: string | null;
  tags?: string[] | null;
  relevance_score?: number | null;
  expires_at?: string | null;
}

export interface UpdatePreferenceStateRequest<TValue = unknown> {
  key?: string;
  value?: TValue;
  visibility?: string;
  description?: string | null;
  tags?: string[] | null;
  relevance_score?: number | null;
  expires_at?: string | null;
}

// Backwards-compatible alias for existing imports in the codebase.
export type RuntimeStateRecord<TValue = unknown> = PreferenceStateRecord<TValue>;
  
export interface AgentResponse {
    id: string;
    user_id: string;
    namespace: string;
    name: string;
    icon: string | null;
    icon_url: string | null;
    description: string | null;
    llm_provider_id: string | null;
    model: string | null;
    temperature: number;
    max_tokens: number | null;
    system_prompt: string;
    input_schema: Record<string, unknown> | null;
    output_schema: Record<string, unknown> | null;
    initial_messages: unknown[] | null;
    enabled_functions: unknown[];
    enabled_agents: unknown[];
    enabled_skills: unknown[];
    function_parameters: Record<string, unknown> | null;
    state_namespaces_readonly: string[];
    state_namespaces_readwrite: string[];
    enabled_collections: unknown[];
    is_active: boolean;
    is_default: boolean;
    created_at: string;
    updated_at: string;
  }

  // Backwards-compatible alias for existing imports in the codebase.
  export type Agent = AgentResponse;
  
