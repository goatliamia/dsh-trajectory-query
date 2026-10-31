// Hook input is per invocation, so parallel Claude sessions cannot overwrite
// a shared "current session" file.
let input = '';
for await (const chunk of process.stdin) input += chunk;
try {
  const event = JSON.parse(input);
  if (event.session_id && event.transcript_path) {
    const message = `Trajectory Tree current Claude session binding: session_id=${JSON.stringify(event.session_id)} transcript_path=${JSON.stringify(event.transcript_path)}. Use this exact transcript path when inspecting this session.`;
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: message } }));
  }
} catch { /* Never block the user's prompt. */ }
