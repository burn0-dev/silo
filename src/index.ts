import { init } from "./cli/init.js";

const command = process.argv[2];

if (!command) {
  console.log(`
Silo

Usage:
  silo init
  silo run
`);
  process.exit(0);
}

switch (command) {
  case "init":
    await init();
    break;

  case "run":
    console.log("Running Silo...");
    break;

  default:
    console.error(`Unknown command: ${command}`);

    process.exit(1);
}
