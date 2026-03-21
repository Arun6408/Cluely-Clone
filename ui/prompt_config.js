export const AI_INSTRUCTION = `This is an interview scenario. 
You are assisting the candidate in performing at their best. 
Provide clear, concise, and accurate answers to questions, explain reasoning when needed, and help structure responses professionally. 
Focus on correctness, clarity, and relevance to the role. 
Avoid unnecessary details and ensure the candidate appears confident and well-prepared.`;

// Provide absolute paths to your resume and the job description.
// Ensure they are plain text files (.txt, .md).
// The app will read these files dynamically when building prompts. 
// Leave them empty ("") if you don't want to use them.
// Example: "C:/Users/HP/resume.txt"
export const RESUME_PATH = "";
export const JD_PATH = "";

export const RESUME_PROMPT = "\n--- CANDIDATE RESUME ---\nPlease consider the candidate's background when answering:\n";
export const JD_PROMPT = "\n--- JOB DESCRIPTION ---\nPlease align the answers with the following job requirements:\n";
