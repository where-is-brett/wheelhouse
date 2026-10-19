// probes/39-transcripts/fields.js
// What check 39's --mine pass may print (ruling E7: the guard fails closed).
//
// FIELD_PATHS lists the key paths of Claude Code's own transcript schema, as
// seen in the scratch run and in the director's own transcripts on 19 October
// 2026 (Claude Code 2.1.111 to 2.1.302), with every map keyed by ids or by the
// person's own data left at its parent (its children print as <key>). A key
// not on this list prints as <key>, nothing below it is read, and the pass
// counts it per parent path, so a later check can widen the list. Arrays are
// `[]`, a message's content blocks `[<block type>]`.
//
// VALUES lists, per field, the values that may print; any other prints as
// <value>. PRESENCE_ONLY fields print only that they are there.

export const FIELD_PATHS = new Set(`
  accountUuid
  advisorModel
  agentId
  agentName
  apiBlockIndex
  apiError
  apiErrorParams apiErrorParams.rate_limit_info apiErrorParams.rate_limit_info.isUsingOverage
  apiErrorParams.rate_limit_info.overageDisabledReason apiErrorParams.rate_limit_info.overageStatus
  apiErrorParams.rate_limit_info.rateLimitType apiErrorParams.rate_limit_info.resetsAt
  apiErrorParams.rate_limit_info.status
  apiErrorStatus
  artifactCount
  artifacts
  atis
  attachment attachment.addedBlocks attachment.addedBlocks[] attachment.addedLines attachment.addedLines[]
  attachment.addedNames attachment.addedNames[] attachment.addedTypes attachment.addedTypes[]
  attachment.allowedTools attachment.allowedTools[] attachment.autoModeConsentFlow
  attachment.availableCommandCount attachment.availableCommandNames attachment.availableCommandNames[]
  attachment.banner attachment.bashFirst attachment.bashFirstSteer attachment.blockHashes
  attachment.blockHashes[] attachment.builtInTypes attachment.builtInTypes[] attachment.bypass
  attachment.canContinueAgent attachment.changed attachment.changes attachment.changes[]
  attachment.changes[].added attachment.changes[].added[] attachment.changes[].field
  attachment.changes[].from attachment.changes[].removed attachment.changes[].removed[] attachment.cliPrefix
  attachment.clientChange attachment.clientChange.baseline attachment.clientChange.callNumber
  attachment.clientChange.firstChangedMessageIndex attachment.clientChange.kinds attachment.command
  attachment.commandMode attachment.commandName attachment.commit attachment.content attachment.content.file
  attachment.content.file.content attachment.content.file.filePath attachment.content.file.numLines
  attachment.content.file.startLine attachment.content.file.totalLines attachment.content.type
  attachment.content[] attachment.content[].activeForm attachment.content[].blockedBy
  attachment.content[].blocks attachment.content[].content attachment.content[].description
  attachment.content[].id attachment.content[].status attachment.content[].subject attachment.context
  attachment.context.gitStatus attachment.context.userEmail attachment.contextRendering attachment.date
  attachment.delivery_id attachment.deltaSummary attachment.description attachment.displayPath
  attachment.durationMs attachment.echoWireToolInputs attachment.entries attachment.entries[]
  attachment.entries[].defer_loading attachment.entries[].description
  attachment.entries[].eager_input_streaming attachment.entries[].input_schema
  attachment.entries[].input_schema.$schema attachment.entries[].input_schema.additionalProperties
  attachment.entries[].input_schema.properties attachment.entries[].input_schema.required
  attachment.entries[].input_schema.type attachment.entries[].name attachment.exitCode
  attachment.exitCommitted attachment.failedMcpServers attachment.failedMcpServers[]
  attachment.failedMcpServers[].error attachment.failedMcpServers[].errorCode
  attachment.failedMcpServers[].name attachment.filename attachment.files
  attachment.firstReportForThreadInProcess attachment.hookEvent attachment.hookName attachment.humanTurn
  attachment.identity attachment.identity.knowledgeCutoff attachment.identity.marketingName
  attachment.identity.modelId attachment.inlineTools attachment.isInitial attachment.isMeta
  attachment.itemCount attachment.keptReminders attachment.managedCommit attachment.managedPr
  attachment.maxTurns attachment.model attachment.nameOnlyAnnouncements attachment.nameOnlyAnnouncements[]
  attachment.names attachment.names[] attachment.needsAuthMcpServers attachment.needsAuthMcpServers[]
  attachment.newDate attachment.newlyDropped attachment.newlyDropped.blockCount attachment.newlyDropped.first
  attachment.newlyDropped.first.blockIndex attachment.newlyDropped.first.messageIndex
  attachment.newlyDropped.last attachment.newlyDropped.last.blockIndex
  attachment.newlyDropped.last.messageIndex attachment.newlyDropped.reason
  attachment.newlyDropped.reasonCounts attachment.newlyDropped.turnCount attachment.organizationUuid
  attachment.origin attachment.origin.body attachment.origin.from attachment.origin.fromMode
  attachment.origin.fromSession attachment.origin.handback attachment.origin.handbackReportText
  attachment.origin.hopChain attachment.origin.hopChain[] attachment.origin.hostInjected
  attachment.origin.kind attachment.origin.msg_id attachment.origin.name attachment.origin.producer
  attachment.origin.senderTaskId attachment.origin.subkind attachment.origin.verifiedPeerPid
  attachment.outputFilePath attachment.pendingMcpServers attachment.pendingMcpServers[] attachment.pr
  attachment.prompt attachment.prompt[] attachment.prompt[].text attachment.prompt[].type
  attachment.querySource attachment.readdedNames attachment.readdedNames[] attachment.reason
  attachment.reminderFold attachment.reminderId attachment.removedByBlock attachment.removedByBlock[]
  attachment.removedNames attachment.removedNames[] attachment.removedTypes attachment.requestId
  attachment.runId attachment.sendUserFileHint attachment.shell attachment.shell.command
  attachment.shell.kind attachment.shell.toolUseId attachment.showConcurrencyNote attachment.skillCount
  attachment.skills attachment.snapshot attachment.snippet attachment.source_uuid attachment.status
  attachment.stderr attachment.stdout attachment.steerOnly attachment.style attachment.style.name
  attachment.style.prompt attachment.suggestion attachment.surfacedDefinitions
  attachment.surfacedDefinitions[] attachment.surfacedDefinitions[].definition
  attachment.surfacedDefinitions[].definition.description
  attachment.surfacedDefinitions[].definition.eager_input_streaming
  attachment.surfacedDefinitions[].definition.input_schema attachment.surfacedDefinitions[].definition.name
  attachment.surfacedDefinitions[].listing attachment.surfacedDefinitions[].name
  attachment.surfacedDefinitions[].sameAs attachment.surfacedNames attachment.surfacedNames[]
  attachment.systemPrompt attachment.systemPrompt[] attachment.systemTurns attachment.taskId
  attachment.taskType attachment.tasks attachment.tasks[] attachment.tasks[].createdAt
  attachment.tasks[].cron attachment.tasks[].id attachment.tasks[].prompt attachment.tasks[].recurring
  attachment.text attachment.thinkingBlocksSent attachment.thinkingTurnsSent attachment.timestamp
  attachment.toolChangeHeader attachment.toolInputCopies attachment.toolInputCopies[]
  attachment.toolInputCopies[].copy attachment.toolInputCopies[].id attachment.toolUseID attachment.tools
  attachment.tools[] attachment.tools[].description attachment.tools[].name attachment.tools[].schema
  attachment.tools[].schema.description attachment.tools[].schema.eager_input_streaming
  attachment.tools[].schema.input_schema attachment.tools[].schema.name attachment.tools[].server
  attachment.turnCount attachment.turnReminder attachment.type attachment.url attachment.usage
  attachment.usage.durationMs attachment.usage.toolUses attachment.usage.totalTokens
  attachment.wireHiddenNames
  attributionAgent
  attributionMcpServer
  attributionMcpTool
  attributionPlugin
  attributionSkill
  backup backup.backupFileName backup.backupTime backup.realParentDir backup.version
  base
  bridgeSessionId
  cacheControl cacheControl[] cacheControl[].path cacheControl[].path[] cacheControl[].value
  cacheControl[].value.scope cacheControl[].value.ttl cacheControl[].value.type
  cause
  classifierBoundary
  classifierMetaLines
  commandRun commandRun.args commandRun.command
  commandUuid
  compactMetadata compactMetadata.cumulativeDroppedTokens compactMetadata.durationMs
  compactMetadata.postTokens compactMetadata.preCompactArtifactReadVersions
  compactMetadata.preCompactArtifactReadVersions[] compactMetadata.preCompactArtifactReadVersions[].slug
  compactMetadata.preCompactArtifactReadVersions[].ver compactMetadata.preCompactDiscoveredTools
  compactMetadata.preCompactDiscoveredTools[] compactMetadata.preTokens compactMetadata.preservedMessages
  compactMetadata.preservedMessages.allUuids compactMetadata.preservedMessages.allUuids[]
  compactMetadata.preservedMessages.anchorUuid compactMetadata.preservedMessages.uuids
  compactMetadata.preservedMessages.uuids[] compactMetadata.preservedSegment
  compactMetadata.preservedSegment.anchorUuid compactMetadata.preservedSegment.headUuid
  compactMetadata.preservedSegment.tailUuid compactMetadata.trigger
  content
  customTitle
  cwd
  deliveryId
  effort
  entrypoint
  error error.connection error.connection.code error.connection.isSSLError error.connection.message
  error.error error.error.error error.error.error.message error.error.error.type error.error.request_id
  error.error.type error.formatted error.headers error.isNetworkDown error.message error.noResponse
  error.rateLimits error.requestID error.status error.type
  folder
  frameUrl
  gitBranch
  hasOutput
  hasUnknownModelCost
  hash
  hookAdditionalContext
  hookCount
  hookErrors
  hookInfos hookInfos[] hookInfos[].command
  id
  imagePasteIds imagePasteIds[]
  isAbortedMidStream
  isApiErrorMessage
  isCompactSummary
  isMeta
  isSidechain
  isSnapshotUpdate
  isVisibleInTranscriptOnly
  keep
  lastPrompt
  lastSequenceNum
  leafUuid
  level
  logicalParentUuid
  maxRetries
  mcpMeta mcpMeta._meta
  mergedSendUuids mergedSendUuids[]
  message message.container message.content message.content[image] message.content[image].source
  message.content[image].source.data message.content[image].source.media_type
  message.content[image].source.type message.content[image].type message.content[text]
  message.content[text].text message.content[text].type message.content[thinking]
  message.content[thinking].signature message.content[thinking].thinking message.content[thinking].type
  message.content[tool_addition] message.content[tool_addition].tool
  message.content[tool_addition].tool.definition message.content[tool_addition].tool.type
  message.content[tool_addition].type message.content[tool_removal] message.content[tool_removal].tool
  message.content[tool_removal].tool.name message.content[tool_removal].tool.type
  message.content[tool_removal].type message.content[tool_result] message.content[tool_result].content
  message.content[tool_result].content[image] message.content[tool_result].content[text]
  message.content[tool_result].content[tool_reference] message.content[tool_result].is_error
  message.content[tool_result].tool_use_id message.content[tool_result].type message.content[tool_use]
  message.content[tool_use].caller message.content[tool_use].caller.type message.content[tool_use].id
  message.content[tool_use].input message.content[tool_use].input.answers
  message.content[tool_use].input.content message.content[tool_use].input.questions
  message.content[tool_use].input.status message.content[tool_use].input.type message.content[tool_use].name
  message.content[tool_use].type message.context_management message.context_management.applied_edits
  message.diagnostics message.diagnostics.cache_miss_reason
  message.diagnostics.cache_miss_reason.cache_missed_input_tokens message.diagnostics.cache_miss_reason.type
  message.id message.input_transformations message.input_transformations[]
  message.input_transformations[].path message.input_transformations[].reason
  message.input_transformations[].type message.model message.output_config message.output_config.effort
  message.role message.stop_details message.stop_details.category message.stop_details.explanation
  message.stop_details.fallback_has_prefill_claim message.stop_details.type message.stop_reason
  message.stop_sequence message.type message.usage message.usage.cache_creation
  message.usage.cache_creation.ephemeral_1h_input_tokens
  message.usage.cache_creation.ephemeral_5m_input_tokens message.usage.cache_creation_input_tokens
  message.usage.cache_read_input_tokens message.usage.fallback_credit message.usage.inference_geo
  message.usage.input_tokens message.usage.iterations message.usage.iterations[]
  message.usage.iterations[].cache_creation message.usage.iterations[].cache_creation_input_tokens
  message.usage.iterations[].cache_read_input_tokens message.usage.iterations[].input_tokens
  message.usage.iterations[].output_tokens message.usage.iterations[].type message.usage.output_tokens
  message.usage.output_tokens_details message.usage.output_tokens_details.thinking_tokens
  message.usage.server_tool_use message.usage.server_tool_use.web_fetch_requests
  message.usage.server_tool_use.web_search_requests message.usage.service_tier message.usage.speed
  messageId
  mode
  modelUsage
  noHistoryBackfill
  operation
  origin origin.body origin.fireReason origin.from origin.fromMode origin.fromSession origin.handback
  origin.handbackReportText origin.hopChain origin.hopChain[] origin.hostInjected origin.kind origin.msg_id
  origin.name origin.producer origin.runId origin.senderTaskId origin.subkind origin.verifiedPeerPid
  ownerAccountUuid
  ownerOrganizationUuid
  params params.betas params.betas[] params.context_management params.context_management.edits
  params.context_management.edits[] params.context_management.edits[].keep
  params.context_management.edits[].type params.max_tokens params.model params.output_config
  params.output_config.effort params.thinking params.thinking.display params.thinking.type
  parentUuid
  path
  perTurnEffort
  permissionDecision permissionDecision.decision permissionDecision.reasonType permissionDecision.source
  permissionMode
  prNumber
  prRepository
  prUrl
  preventedContinuation
  projectsUserTurn
  promptId
  promptSource
  querySource
  queueSkipAttachments
  queueSkipSlashCommands
  queueTranscriptOnly
  quotaLimits quotaLimits.isUsingOverage quotaLimits.overageDisabledReason quotaLimits.overageStatus
  quotaLimits.rateLimitType quotaLimits.resetsAt quotaLimits.status
  quotaLimits.unifiedRateLimitFallbackAvailable quotaLimits.upgradePaths quotaLimits.upgradePaths[]
  reason
  refusedMessageId
  relocatedCwd
  rendered rendered[] rendered[].content rendered[].content[text] rendered[].content[text].text
  rendered[].content[text].type
  renderedBesideToolResult
  renderedInHumanTurn renderedInHumanTurn[] renderedInHumanTurn[].content
  renderedRole
  requestDigest
  requestId
  requestRef
  requestedModel
  retryAttempt
  retryInMs
  serverClassifierContext serverClassifierContext.context serverClassifierContext.context.git_state
  serverClassifierContext.context.git_state.branch serverClassifierContext.context.git_state.cwd
  serverClassifierContext.context.git_state.default_branch serverClassifierContext.context.git_state.error
  serverClassifierContext.context.git_state.root serverClassifierContext.context.git_state.status
  serverClassifierContext.context.git_state.status.clean
  serverClassifierContext.context.git_state.status.counts
  serverClassifierContext.context.git_state.status.porcelain
  serverClassifierContext.context.git_state.status.truncated
  serverClassifierContext.context.git_state.visibility
  serverClassifierContext.context.git_state.visibility.origin
  serverClassifierContext.context.git_state.visibility.push_remote
  serverClassifierContext.context.git_state.visibility.remotes
  serverClassifierContext.context.git_state.visibility.visibility_cache
  serverClassifierContext.context.live_cwd serverClassifierContext.context.platform
  serverClassifierContext.request
  serverClassifierRequest
  sessionId
  shape shape.system shape.system[] shape.system[].text shape.system[].type shape.tools shape.tools[]
  shape.tools[].defer_loading shape.tools[].description shape.tools[].eager_input_streaming
  shape.tools[].input_schema shape.tools[].input_schema.$schema
  shape.tools[].input_schema.additionalProperties shape.tools[].input_schema.properties
  shape.tools[].input_schema.required shape.tools[].input_schema.type shape.tools[].model shape.tools[].name
  shape.tools[].type
  shapeHash
  slug
  snapshot
  snapshotMessageId
  source
  sourceToolAssistantUUID
  sourceToolUseID
  startTime
  stopReason
  subtype
  tail tail[]
  thinkingDisplay
  thinkingDurationMs
  timestamp
  title
  toolDenialKind
  toolEndsTurn
  toolResultRemedy toolResultRemedy.kind
  toolUseID
  toolUseResult toolUseResult.agentId toolUseResult.answers toolUseResult.commandName toolUseResult.content
  toolUseResult.file toolUseResult.filePath toolUseResult.interrupted toolUseResult.isAsync
  toolUseResult.questions toolUseResult.status toolUseResult.stderr toolUseResult.stdout
  toolUseResult.success toolUseResult.type
  totalAPIDuration
  totalAPIDurationWithoutRetries
  totalCostUSD
  totalDuration
  totalLinesAdded
  totalLinesRemoved
  totalToolDuration
  trackingPath
  ts
  turnCompanion
  turnOrigin
  turnPosition turnPosition.promptIndex turnPosition.turnIndex
  type
  userType
  uuid
  v
  verifiedSlackHumanTurn
  version
  vetoedAgainstAccountUuid
  wireIngestContext
  wireToolInputs
  worktreeSession worktreeSession.originalBranch worktreeSession.originalCwd
  worktreeSession.originalHeadCommit worktreeSession.preEnterOriginalCwd worktreeSession.sessionId
  worktreeSession.worktreeBranch worktreeSession.worktreeName worktreeSession.worktreePath
  message.usage.iterations[].cache_creation.ephemeral_1h_input_tokens message.usage.iterations[].cache_creation.ephemeral_5m_input_tokens
  message.content[tool_result].content[text].text message.content[tool_result].content[text].type
  message.content[tool_result].content[image].type message.content[tool_result].content[tool_reference].type
`.split(/\s+/).filter(Boolean));

// The content block types that may name a block in a path.
export const BLOCK_TYPES = new Set(['text', 'tool_use', 'tool_result', 'thinking', 'redacted_thinking', 'image', 'document',
  'tool_addition', 'tool_removal', 'tool_reference', 'server_tool_use', 'web_search_tool_result']);

// Claude Code's own tools. An MCP tool prints as `mcp tool`, any other as `other tool`.
export const TOOL_NAMES = new Set(['Agent', 'Artifact', 'AskUserQuestion', 'Bash', 'CronCreate', 'DesignSync', 'Edit',
  'EnterWorktree', 'ExitWorktree', 'Glob', 'Grep', 'ListAgents', 'Monitor', 'NotebookEdit', 'PushNotification', 'Read',
  'ReadNotifications', 'ScheduleWakeup', 'SendMessage', 'SendUserFile', 'Skill', 'SubagentHandback', 'TaskCreate',
  'TaskList', 'TaskStop', 'TaskUpdate', 'TodoWrite', 'ToolSearch', 'WebFetch', 'WebSearch', 'Write', 'bash']);

const ORIGIN_KINDS = ['human', 'peer', 'task-notification', 'coordinator', 'plugin', 'bridge'];

export const VALUES = {
  type: ['user', 'assistant', 'attachment', 'system', 'queue-operation', 'last-prompt', 'atis-latch', 'custom-title',
    'agent-name', 'bridge-session', 'api-request', 'api-request-blob', 'api-request-shape', 'mode', 'pr-link',
    'cost-state', 'file-history-snapshot', 'file-history-delta', 'history-suppression', 'frame-link', 'permission-mode',
    'relocated', 'worktree-state', 'dev-mods', 'ai-title', 'artifact-comment-monitor', 'artifact-autoreact-ledger', 'summary'],
  subtype: ['api_error', 'compact_boundary', 'local_command', 'stop_hook_summary', 'turn_duration', 'informational',
    'model_refusal_fallback'],
  'attachment.type': ['agent_listing_delta', 'auto_mode', 'auto_mode_exit', 'command_permissions', 'compact_file_reference',
    'credential_org', 'date', 'date_change', 'deferred_tools_delta', 'deferred_tools_record', 'edited_text_file',
    'environment', 'file', 'hook_additional_context', 'hook_non_blocking_error', 'hook_success', 'instructions',
    'invoked_skills', 'max_turns_reached', 'mcp_instructions_delta', 'model', 'output_style', 'output_style_instructions',
    'prompt_snapshot', 'queued_command', 'read_truncation_notice', 'remote_session_change', 'sandbox_instructions',
    'session_context', 'session_cron_carry', 'silent_turn_reminder', 'skill_listing', 'task_reminder', 'task_status',
    'thinking_drop', 'todo_reminder', 'total_tokens_reminder', 'ultrathink_effort', 'unknown_command_fallback'],
  userType: ['external'],
  entrypoint: ['claude-desktop', 'sdk-cli', 'cli'],
  'origin.kind': ORIGIN_KINDS,
  'attachment.origin.kind': ORIGIN_KINDS,
  'origin.subkind': ['projects-relay', 'scheduled-trigger'],
  'origin.fromMode': ['prompting'],
  promptSource: ['sdk', 'system', 'typed'],
  turnOrigin: ['human', 'peer', 'scheduled', 'sdk', 'system', 'task_notification'],
  permissionMode: ['default', 'acceptEdits', 'auto', 'bypassPermissions', 'dontAsk', 'plan'],
  level: ['error', 'info', 'suggestion', 'warning'],
  operation: ['enqueue', 'dequeue', 'remove'],
  'message.role': ['user', 'assistant', 'system'],
  'message.type': ['message'],
  'message.stop_reason': ['end_turn', 'tool_use', 'stop_sequence', 'refusal', 'max_tokens', 'pause_turn'],
  'toolUseResult.status': ['completed', 'async_launched'],
  'toolUseResult.type': ['text', 'create', 'update', 'image', 'file_unchanged'],
  'attachment.hookEvent': ['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'PreToolUse', 'Stop', 'SubagentStart', 'SubagentStop'],
  'attachment.hookName': ['SessionStart', 'SessionStart:startup', 'SessionStart:compact', 'SessionStart:resume',
    'SessionStart:clear', 'UserPromptSubmit', 'PostToolUse:Edit', 'PostToolUse:Write'],
  'attachment.commandMode': ['prompt', 'task-notification'],
  mode: ['normal'],
  renderedRole: ['system', 'user', 'assistant'],
  toolDenialKind: ['automode-blocked', 'automode-unavailable', 'permission-rule', 'user-rejected'],
};

// Fields printed only as present: their values can name things.
export const PRESENCE_ONLY = new Set(['source', 'origin.handback', 'origin.producer', 'sessionKind']);
