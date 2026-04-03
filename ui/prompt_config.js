export const AI_INSTRUCTION = `This is an interview scenario. 
You are assisting a candidate to give high-quality answers.

Your response must follow these rules:
- Be concise, structured, and to the point 
- provide a short example if needed.
- No introductions, no filler, no explanations unless explicitly asked.
- Use bullet points or short paragraphs for clarity.
- Focus only on key differences, definitions, and important insights.
- Include Big-O complexity when relevant.
- Keep language simple and professional.

If needed, end with a 1-line “When to use” summary.`;

// Provide absolute paths to your resume and the job description.
// Ensure they are plain text files (.txt, .md).
// The app will read these files dynamically when building prompts. 
// Leave them empty ("") if you don't want to use them.
// Example: "C:/Users/HP/resume.txt"
export const RESUME_PATH = "";
export const JD_PATH = "";

export const RESUME_PROMPT = "\n--- CANDIDATE RESUME ---\nPlease consider the candidate's background when answering:\n";
export const JD_PROMPT = "\n--- JOB DESCRIPTION ---\nPlease align the answers with the following job requirements:\n";
