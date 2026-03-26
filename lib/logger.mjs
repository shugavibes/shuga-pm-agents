const c = {
  blue: '\x1b[0;34m', green: '\x1b[0;32m',
  yellow: '\x1b[1;33m', red: '\x1b[0;31m',
  magenta: '\x1b[0;35m', cyan: '\x1b[0;36m', reset: '\x1b[0m',
};

export const log = {
  info:    (m) => console.log(`${c.blue}[INFO]${c.reset} ${m}`),
  success: (m) => console.log(`${c.green}[SUCCESS]${c.reset} ${m}`),
  warning: (m) => console.warn(`${c.yellow}[WARNING]${c.reset} ${m}`),
  error:   (m) => console.error(`${c.red}[ERROR]${c.reset} ${m}`),
  step:    (m) => console.log(`${c.magenta}[STEP]${c.reset} ${m}`),
  agent:   (name, m) => console.log(`${c.cyan}[${name.toUpperCase()}]${c.reset} ${m}`),
};
