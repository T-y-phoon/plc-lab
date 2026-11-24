(() => {
  "use strict";
  const tool = document.querySelector("#flowchart-tool");
  const get = id => tool.querySelector("#flowchart-" + id);
  const file = get("file");
  const source = get("source");
  const status = get("status");
  const preview = get("preview");
  const picture = preview.querySelector("img");
  const generateButton = get("render");
  const markdownButton = get("markdown");
  const svgButton = get("svg");
  const libraryURL = new URL("./vendor/mermaid/mermaid.min.js", document.currentScript.src);
  const maxLength = 40_000;

  const example = `# 单箱自动装填 · 核验示例

\`\`\`mermaid
flowchart TD
  Ready(["中间空箱就位，选择自动并启动"]) --> Left["左行至左限位，立即停车"]
  Left --> WaitLeft["到站等待 2 秒"]
  WaitLeft --> Foam["泡沫投放 3 秒；完成时泡沫计数加一"]
  Foam --> AfterFoam["投后等待 2 秒"]
  AfterFoam --> Filled{"泡沫 4 份且产品 3 件？"}
  Filled -->|否| Right["右行至右限位，立即停车"]
  Right --> WaitRight["到站等待 2 秒"]
  WaitRight --> Product["产品投放 5 秒；完成时产品计数加一"]
  Product --> AfterProduct["投后等待 2 秒"]
  AfterProduct --> Left
  Filled -->|是| Center["右行回中，中间检测有效即停车"]
  Center --> Lamp["运行灯以 0.5 Hz 闪烁 10 次"]
  Lamp --> Finish(["本箱结束，等待复位"])
\`\`\``;

  let enginePending;
  let pictureURL;
  let result;
  let nextRun = 0;

  function extractDiagram(text) {
    if (text.length > maxLength) throw new Error("请使用不超过 4 万字符的工序流程图源码。");
    const fenced = text.matchAll(/^([\x60~]{3,})[ \t]*mermaid[ \t]*\r?\n([\s\S]*?)^\1[ \t]*$/gim);
    const matches = Array.from(fenced, match => match[2].trim());
    if (matches.length > 1) throw new Error("请在文件中保留一个 Mermaid 流程图代码块。");
    const code = matches[0] ?? text.trim();
    if (!/^(?:flowchart|graph)\s+(?:TD|TB|BT|LR|RL)\b/i.test(code)) {
      throw new Error("请粘贴以 flowchart TD 等方向声明开头的 Mermaid 源码，或上传含 mermaid 代码块的 Markdown。");
    }
    if (/%%\{|^\s*click\s|<\/?(?:script|iframe|foreignObject)\b|@\{[^}]*\b(?:img|icon)\s*:/im.test(code)) {
      throw new Error("课堂图稿请使用文本节点、图形和连线。请删除链接、外部图片及配置指令。");
    }
    return code;
  }

  function engine() {
    enginePending ??= new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = libraryURL.href;
      script.onload = () => {
        if (!window.mermaid) {
          reject(new Error("流程图组件不可用，请刷新网页后重试。"));
          return;
        }
        window.mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          htmlLabels: false,
          maxTextSize: maxLength,
          maxEdges: 200,
        });
        resolve(window.mermaid);
      };
      script.onerror = () => reject(new Error("流程图组件加载失败，请检查网站文件是否完整。"));
      document.head.append(script);
    }).catch(error => {
      enginePending = undefined;
      throw error;
    });
    return enginePending;
  }

  function resetPreview() {
    result = undefined;
    svgButton.disabled = true;
    markdownButton.disabled = true;
    preview.hidden = true;
    picture.removeAttribute("src");
    if (pictureURL) URL.revokeObjectURL(pictureURL);
    pictureURL = undefined;
  }

  async function generate() {
    const id = ++nextRun;
    resetPreview();
    generateButton.disabled = true;
    status.textContent = "正在生成流程图…";
    const sandbox = document.createElement("div");
    sandbox.style.cssText = "position:fixed;left:-10000px;top:0;width:1000px;visibility:hidden";
    document.body.append(sandbox);
    try {
      const code = extractDiagram(source.value);
      const mermaid = await engine();
      const { svg } = await mermaid.render("packing-flowchart-" + id, code, sandbox);
      if (id !== nextRun) return;
      result = { code, svg };
      pictureURL = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
      picture.src = pictureURL;
      preview.hidden = false;
      svgButton.disabled = false;
      markdownButton.disabled = false;
      status.textContent = "已生成。可导出 Markdown 源码或 SVG 图。";
    } catch (error) {
      if (id !== nextRun) return;
      const heading = String(error.message ?? error).split("\n")[0];
      status.textContent = /^请|^课堂|^流程图组件/.test(heading)
        ? heading : "生成失败。请检查节点引号、箭头和分支写法后重试。";
    } finally {
      sandbox.remove();
      if (id === nextRun) generateButton.disabled = false;
    }
  }

  function download(value, type, name) {
    const url = URL.createObjectURL(new Blob([value], { type }));
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  file.addEventListener("change", async () => {
    const selected = file.files[0];
    if (!selected) return;
    file.value = "";
    if (selected.size > maxLength * 4) {
      status.textContent = "文件过大，请上传单张工序流程图的源码。";
      return;
    }
    try {
      source.value = await selected.text();
      await generate();
    } catch {
      status.textContent = "文件读取失败，请重试或粘贴源码。";
    }
  });
  get("example").addEventListener("click", () => {
    source.value = example;
    void generate();
  });
  source.addEventListener("input", () => {
    if (!pictureURL && generateButton.disabled === false) return;
    nextRun++;
    resetPreview();
    generateButton.disabled = false;
    status.textContent = "源码已修改，请重新生成。";
  });
  generateButton.addEventListener("click", () => void generate());
  markdownButton.addEventListener("click", () => {
    if (result) download("# 工序流程图\n\n```mermaid\n" + result.code + "\n```\n", "text/markdown;charset=utf-8", "工序流程图.md");
  });
  svgButton.addEventListener("click", () => {
    if (result) download(result.svg, "image/svg+xml;charset=utf-8", "工序流程图.svg");
  });
})();
