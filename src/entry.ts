#!/usr/bin/env node
/**
 * OwliaBot entry point
 */

import { program } from "commander";

program
  .name("owliabot")
  .description("Crypto-native AI agent for Telegram and Discord")
  .version("0.1.0");

program
  .command("start")
  .description("Start the bot")
  .option("-c, --config <path>", "Config file path", "config.yaml")
  .action(async (options) => {
    console.log("Starting OwliaBot...", options);
    // TODO: Load config and start gateway
  });

program.parse();
