import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function formatTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function generateId(): string {
  return Math.random().toString(36).substring(2, 9);
}

export function getRandomColor(): string {
  const colors = [
    "#3b82f6", // blue
    "#a855f7", // purple
    "#22c55e", // green
    "#ef4444", // red
    "#f59e0b", // amber
    "#ec4899", // pink
    "#06b6d4", // cyan
    "#8b5cf6", // violet
    "#14b8a6", // teal
    "#f97316", // orange
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}

export function getFileIcon(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  const basename = filename.split("/").pop()?.toLowerCase() || "";

  // Special files
  if (basename === "dockerfile") return "🐳";
  if (basename.startsWith("docker-compose")) return "🐳";
  if (basename === "makefile") return "🔧";
  if (basename === "package.json") return "📦";
  if (basename === "cargo.toml") return "📦";
  if (basename.startsWith(".git")) return "📂";
  if (basename.startsWith(".env")) return "🔐";

  const iconMap: Record<string, string> = {
    // Rust
    rs: "🦀",
    // JavaScript/TypeScript
    js: "📜",
    mjs: "📜",
    cjs: "📜",
    ts: "📘",
    mts: "📘",
    jsx: "⚛️",
    tsx: "⚛️",
    vue: "💚",
    svelte: "🔥",
    // Web
    html: "🌐",
    htm: "🌐",
    css: "🎨",
    scss: "🎨",
    sass: "🎨",
    less: "🎨",
    // Data
    json: "📋",
    yaml: "📋",
    yml: "📋",
    toml: "⚙️",
    xml: "📋",
    // Markdown
    md: "📝",
    mdx: "📝",
    // Python
    py: "🐍",
    pyw: "🐍",
    ipynb: "📓",
    // Go
    go: "🐹",
    // Ruby
    rb: "💎",
    erb: "💎",
    // PHP
    php: "🐘",
    // Java/JVM
    java: "☕",
    kt: "🟣",
    scala: "🔴",
    groovy: "🌟",
    clj: "λ",
    // .NET
    cs: "🟢",
    fs: "🔵",
    // Shell
    sh: "💻",
    bash: "💻",
    zsh: "💻",
    ps1: "💠",
    // Database
    sql: "🗃️",
    prisma: "🔺",
    // Config
    env: "🔐",
    lock: "🔒",
    // Swift/Apple
    swift: "🍎",
    m: "🍎",
    // Dart
    dart: "🎯",
    // Elixir/Erlang
    ex: "💧",
    exs: "💧",
    erl: "📡",
    // Haskell
    hs: "λ",
    // Docker
    dockerfile: "🐳",
    // Terraform
    tf: "🏗️",
    // Misc
    graphql: "◼️",
    gql: "◼️",
    proto: "📡",
    diff: "📊",
    patch: "📊",
    log: "📜",
    txt: "📄",
    csv: "📊",
  };
  return iconMap[ext] || "📄";
}

export function getLanguageFromFilename(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  const basename = filename.split("/").pop()?.toLowerCase() || "";

  // Check for special filenames first
  const specialFiles: Record<string, string> = {
    dockerfile: "dockerfile",
    "docker-compose.yml": "yaml",
    "docker-compose.yaml": "yaml",
    makefile: "makefile",
    "cmakelists.txt": "cmake",
    gemfile: "ruby",
    rakefile: "ruby",
    vagrantfile: "ruby",
    jenkinsfile: "groovy",
    ".gitignore": "ignore",
    ".dockerignore": "ignore",
    ".env": "dotenv",
    ".env.local": "dotenv",
    ".env.development": "dotenv",
    ".env.production": "dotenv",
    ".eslintrc": "json",
    ".prettierrc": "json",
    ".babelrc": "json",
    "tsconfig.json": "jsonc",
    "jsconfig.json": "jsonc",
    "package.json": "json",
    "composer.json": "json",
    "cargo.toml": "toml",
    "go.mod": "go",
    "go.sum": "go",
  };

  if (specialFiles[basename]) {
    return specialFiles[basename];
  }

  const langMap: Record<string, string> = {
    // JavaScript/TypeScript ecosystem
    js: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    jsx: "javascriptreact",
    ts: "typescript",
    mts: "typescript",
    cts: "typescript",
    tsx: "typescriptreact",
    vue: "vue",
    svelte: "svelte",
    astro: "astro",

    // Web technologies
    html: "html",
    htm: "html",
    xhtml: "html",
    css: "css",
    scss: "scss",
    sass: "scss",
    less: "less",
    styl: "stylus",

    // Data formats
    json: "json",
    jsonc: "jsonc",
    json5: "json5",
    yaml: "yaml",
    yml: "yaml",
    toml: "toml",
    xml: "xml",
    xsl: "xml",
    xsd: "xml",
    svg: "xml",
    plist: "xml",

    // Markdown & docs
    md: "markdown",
    mdx: "mdx",
    markdown: "markdown",
    rst: "restructuredtext",
    adoc: "asciidoc",
    tex: "latex",
    latex: "latex",

    // Systems programming
    rs: "rust",
    c: "c",
    h: "c",
    cpp: "cpp",
    cc: "cpp",
    cxx: "cpp",
    hpp: "cpp",
    hxx: "cpp",
    hh: "cpp",
    zig: "zig",
    nim: "nim",
    v: "v",

    // Go
    go: "go",
    mod: "go",

    // Python
    py: "python",
    pyw: "python",
    pyi: "python",
    pyx: "cython",
    pxd: "cython",
    ipynb: "jupyter",

    // Ruby
    rb: "ruby",
    erb: "erb",
    rake: "ruby",
    gemspec: "ruby",

    // PHP
    php: "php",
    phtml: "php",
    php3: "php",
    php4: "php",
    php5: "php",
    phps: "php",
    blade: "blade",

    // Java/JVM
    java: "java",
    kt: "kotlin",
    kts: "kotlin",
    scala: "scala",
    sc: "scala",
    groovy: "groovy",
    gradle: "groovy",
    clj: "clojure",
    cljs: "clojure",
    cljc: "clojure",
    edn: "clojure",

    // .NET
    cs: "csharp",
    fs: "fsharp",
    fsx: "fsharp",
    vb: "vb",
    xaml: "xml",
    csproj: "xml",
    fsproj: "xml",
    sln: "plaintext",

    // Shell/Scripts
    sh: "shellscript",
    bash: "shellscript",
    zsh: "shellscript",
    fish: "shellscript",
    ksh: "shellscript",
    csh: "shellscript",
    ps1: "powershell",
    psm1: "powershell",
    psd1: "powershell",
    bat: "bat",
    cmd: "bat",

    // Database
    sql: "sql",
    mysql: "sql",
    pgsql: "sql",
    plsql: "sql",
    prisma: "prisma",

    // Config files
    ini: "ini",
    cfg: "ini",
    conf: "ini",
    properties: "properties",
    env: "dotenv",
    editorconfig: "editorconfig",
    gitignore: "ignore",
    dockerignore: "ignore",

    // Functional languages
    hs: "haskell",
    lhs: "haskell",
    ml: "ocaml",
    mli: "ocaml",
    elm: "elm",
    ex: "elixir",
    exs: "elixir",
    erl: "erlang",
    hrl: "erlang",

    // Other languages
    r: "r",
    R: "r",
    rmd: "rmd",
    jl: "julia",
    lua: "lua",
    pl: "perl",
    pm: "perl",
    swift: "swift",
    m: "objective-c",
    mm: "objective-cpp",
    d: "d",
    dart: "dart",
    coffee: "coffeescript",
    litcoffee: "coffeescript",

    // Lisp family
    lisp: "lisp",
    lsp: "lisp",
    el: "lisp",
    scm: "scheme",
    rkt: "racket",

    // Assembly
    asm: "asm",
    s: "asm",
    S: "asm",

    // GraphQL & API
    graphql: "graphql",
    gql: "graphql",
    proto: "protobuf",
    thrift: "thrift",

    // Build tools
    cmake: "cmake",
    make: "makefile",
    mk: "makefile",

    // Templates
    hbs: "handlebars",
    handlebars: "handlebars",
    mustache: "handlebars",
    ejs: "html",
    pug: "pug",
    jade: "pug",
    njk: "nunjucks",
    twig: "twig",
    liquid: "liquid",

    // Misc
    dockerfile: "dockerfile",
    tf: "terraform",
    tfvars: "terraform",
    hcl: "hcl",
    nix: "nix",
    diff: "diff",
    patch: "diff",
    log: "log",
    txt: "plaintext",
    text: "plaintext",
    csv: "plaintext",
    tsv: "plaintext",
  };

  return langMap[ext] || "plaintext";
}

export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number,
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;
  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

export function throttle<T extends (...args: any[]) => any>(
  func: T,
  limit: number,
): (...args: Parameters<T>) => void {
  let inThrottle = false;
  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}
