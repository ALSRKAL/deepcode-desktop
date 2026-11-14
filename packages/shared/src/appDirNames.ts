/**
 * DeepCode Studio 落盘命名空间的唯一来源（docs/plan/01 §2.1）。
 *
 * 数据目录名从上游 `.zcodium*` 改为 `.deepcode*`，不做旧目录迁移（没有需要迁移的
 * 存量安装）。新增目录或文件名时必须引用这些常量，不要散落字面量，否则改名会漏改。
 */

/** 用户级数据根目录名，默认 `~/.deepcode`（可被 ZCODE_DATA_BASE_DIR 改写基路径）。 */
export const ZCODE_USER_DATA_DIR_NAME = ".deepcode";

/** 用户级 App 配置子目录名，即 `~/.deepcode/v2`。 */
export const ZCODE_APP_CONFIG_SUBDIR_NAME = "v2";

/** 工作区级配置目录名，即 `<workspace>/.deepcode`。 */
export const ZCODE_WORKSPACE_CONFIG_DIR_NAME = ".deepcode";

/** 工作区级配置文件名。 */
export const ZCODE_WORKSPACE_CONFIG_FILE_NAME = "deepcode.json";

/** 工作区文件搜索忽略规则文件名。 */
export const ZCODE_WORKSPACE_IGNORE_FILE_NAME = ".deepcodeignore";

/** 插件清单目录名，即 `<plugin>/.deepcode-plugin/plugin.json`。 */
export const ZCODE_PLUGIN_MANIFEST_DIR_NAME = ".deepcode-plugin";

/** 插件清单文件名。 */
export const ZCODE_PLUGIN_MANIFEST_FILE_NAME = "plugin.json";
