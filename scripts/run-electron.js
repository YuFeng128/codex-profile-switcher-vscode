const { spawn } = require("child_process");
const electron = require("electron");

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

if (process.argv.includes("--smoke")) {
  env.CODEX_DESKTOP_SMOKE = "1";
}

const child = spawn(electron, ["./desktop"], {
  env,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
