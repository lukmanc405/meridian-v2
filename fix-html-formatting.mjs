// Fix Telegram HTML formatting
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Convert markdown to HTML
function mdToHtml(text) {
  if (!text || typeof text !== 'string') return text;
  
  // Convert **bold** to <b>bold</b>
  text = text.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  
  // Convert *italic* to <i>italic</i> (but not if it's part of **)
  text = text.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<i>$1</i>');
  
  // Convert `code` to <code>code</code>
  text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
  
  // Convert line breaks - in HTML we can use \n for simple newlines in Telegram
  // Telegram HTML supports \n for newlines
  
  return text;
}

const files = [
  path.join(__dirname, 'index.js'),
  path.join(__dirname, 'briefing.js'),
  path.join(__dirname, 'telegram.js'),
  path.join(__dirname, 'telegram-callbacks.js'),
];

for (const file of files) {
  let content;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  
  const original = content;
  
  // Find all sendMessage calls with backtick templates that have markdown
  // Pattern: sendMessage(`...**...`...) or sendMessage("...") with markdown
  
  // Convert backtick template literals with markdown
  // Match: sendMessage(`...${...}...`)
  content = content.replace(
    /sendMessage\(`((?:[^`\\]|\\.|`\$\{[^}]*\}`)*)`\)/g,
    (match, template) => {
      const html = mdToHtml(template);
      return `sendHTML(\`${html}\`)`;
    }
  );
  
  // Also convert: sendMessage("string with **bold**")
  content = content.replace(
    /sendMessage\("((?:[^"\\]|\\.)*)"\)/g,
    (match, str) => {
      if (str.includes('**') || str.includes('*') || str.includes('`')) {
        const html = mdToHtml(str);
        return `sendHTML("${html}")`;
      }
      return match;
    }
  );
  
  if (content !== original) {
    writeFileSync(file, content);
    console.log('Fixed:', path.basename(file));
  }
}

console.log('Done!');
