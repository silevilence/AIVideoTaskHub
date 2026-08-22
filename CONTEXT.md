# AI Video Task Hub

This context describes reusable video-generation configurations and the tasks submitted from them across external providers.

## Language

**工作流模板（Workflow Template）**:
可复用的 ComfyUI API 格式工作流及其面向任务创建者的输入定义。
_Avoid_: 模型、普通工作流 JSON

**API 格式工作流（API-format Workflow）**:
以节点 ID 为键、由 `class_type` 和 `inputs` 描述节点，可直接提交给 ComfyUI `/prompt` 端点的 JSON 图。
_Avoid_: UI 工作流、画布工作流

**模板变量（Template Variable）**:
工作流模板声明的任务输入；在 API 格式工作流中以 `${name}` 字符串令牌引用，并在任务提交前按声明类型替换。
_Avoid_: 模型参数、节点参数、裸占位符

**主描述变量（Primary Description Variable）**:
工作流模板可选指定的字符串模板变量，其任务值作为该任务的描述、列表摘要与搜索文本；未指定时以工作流模板名称作为任务描述。
_Avoid_: 内置 Prompt、固定 `${prompt}`

**主输出（Primary Output）**:
工作流模板指定的单个 ComfyUI 输出文件，作为任务成功后保存和展示的视频结果。
_Avoid_: 第一个输出、全部工作流输出

**任务快照（Task Snapshot）**:
任务创建时固定保存的工作流模板内容、变量值、主输出规则与实际连接地址；后续模板编辑不会改变该任务的提交、重试或参数套用行为。
_Avoid_: 当前模板、最新模板
