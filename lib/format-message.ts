// 简单的消息格式化函数
export function formatMessage(
    template: string | undefined,
    values?: Record<string, string | number>,
): string {
    if (!template) return ""
    if (!values) return template

    return Object.entries(values).reduce((result, [key, value]) => {
        return result.replace(new RegExp(`{${key}}`, "g"), String(value))
    }, template)
}
