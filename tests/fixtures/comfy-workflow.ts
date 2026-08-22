export function comfyWorkflowTemplateDocument(
    name: string,
    options: { includeUnused?: boolean } = {}
): string {
    return `---
schemaVersion: 1
name: ${name}
primaryDescription: prompt
primaryOutput:
  nodeId: "2"
  field: videos
  index: 0
variables:
  - key: prompt
    label: 提示词
    type: string
${options.includeUnused ? '  - key: seed\n    label: 随机种子\n    type: integer\n' : ''}---
{
  "1": { "class_type": "TextNode", "inputs": { "text": "\${prompt}" } },
  "2": { "class_type": "VideoNode", "inputs": { "source": ["1", 0] } }
}`;
}
