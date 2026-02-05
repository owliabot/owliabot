// workspace/skills/todo/index.js
// Demonstrates: write-level skill (WriteGate approval happens at tool invocation)
// Since this skill declares security.level="write", file writes are allowed after
// ToolRouter approves the tool call through WriteGate.

const TODO_FILE = "todo.md";

export const tools = {
  add: async ({ item }, context) => {
    const todoPath = `${context.workspace}/${TODO_FILE}`;

    try {
      // Read existing content (may not exist yet)
      let content = "";
      try {
        content = await context.readFile(todoPath);
      } catch {
        // File doesn't exist, start fresh
        content = "# Todo List\n\n";
      }

      // Append new item
      // This triggers WriteGate: "About to edit todo.md. Proceed? [yes/no]"
      const newItem = `- [ ] ${item}\n`;
      const newContent = content.trimEnd() + "\n" + newItem;

      await context.writeFile(todoPath, newContent);

      return {
        success: true,
        data: {
          action: "added",
          item,
          path: todoPath,
        },
      };
    } catch (err) {
      return {
        success: false,
        error: `Failed to add todo: ${err.message}`,
      };
    }
  },

  list: async (params, context) => {
    const todoPath = `${context.workspace}/${TODO_FILE}`;

    try {
      const content = await context.readFile(todoPath);

      // Parse todo items
      const lines = content.split("\n");
      const items = [];
      let number = 0;

      for (const line of lines) {
        const unchecked = line.match(/^- \[ \] (.+)$/);
        const checked = line.match(/^- \[x\] (.+)$/i);

        if (unchecked) {
          number++;
          items.push({ number, text: unchecked[1], done: false });
        } else if (checked) {
          number++;
          items.push({ number, text: checked[1], done: true });
        }
      }

      return {
        success: true,
        data: {
          items,
          total: items.length,
          pending: items.filter((i) => !i.done).length,
          completed: items.filter((i) => i.done).length,
        },
      };
    } catch (err) {
      if (err.code === "ENOENT") {
        return {
          success: true,
          data: {
            items: [],
            total: 0,
            pending: 0,
            completed: 0,
          },
        };
      }
      return {
        success: false,
        error: `Failed to list todos: ${err.message}`,
      };
    }
  },

  complete: async ({ number }, context) => {
    const todoPath = `${context.workspace}/${TODO_FILE}`;

    try {
      const content = await context.readFile(todoPath);
      const lines = content.split("\n");

      let itemCount = 0;
      let found = false;
      let completedText = "";

      const newLines = lines.map((line) => {
        const unchecked = line.match(/^- \[ \] (.+)$/);
        if (unchecked) {
          itemCount++;
          if (itemCount === number) {
            found = true;
            completedText = unchecked[1];
            return `- [x] ${unchecked[1]}`;
          }
        }
        return line;
      });

      if (!found) {
        return {
          success: false,
          error: `Todo item #${number} not found or already completed`,
        };
      }

      // This triggers WriteGate confirmation
      await context.writeFile(todoPath, newLines.join("\n"));

      return {
        success: true,
        data: {
          action: "completed",
          number,
          item: completedText,
        },
      };
    } catch (err) {
      return {
        success: false,
        error: `Failed to complete todo: ${err.message}`,
      };
    }
  },
};
