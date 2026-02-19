import type { LLM } from '../../lib/llm';
import type { Correction } from './types';

export async function correctInstruction(
  llm: LLM, instruction: string, corrections: Correction[],
): Promise<string> {
  if (!corrections.length) return instruction;
  const examples = corrections.map(c => `- "${c.heard}" → "${c.meant}"`).join('\n');
  const prompt = `Fix speech-to-text errors in this instruction.\n\nKnown corrections:\n${examples}\n\nInstruction: "${instruction}"\n\nReturn only the corrected text.`;
  const result = await llm(prompt);
  const corrected = result.trim() || instruction;
  if (corrected !== instruction) {
    console.log(
      `%c[LLM auto correct]%c\nReceived: ${instruction}\nCorrection: ${corrected}`,
      'background:#059669;color:white;font-weight:bold;padding:2px 6px;border-radius:3px',
      'color:#059669;white-space:pre-wrap',
    );
  } else {
    console.log(
      `%c[LLM auto correct]%c\nReceived: ${instruction} (unchanged)`,
      'background:#059669;color:white;font-weight:bold;padding:2px 6px;border-radius:3px',
      'color:#059669;white-space:pre-wrap',
    );
  }
  return corrected;
}
