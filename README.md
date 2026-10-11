# StudySpace AI

An academic assistant for assignments, quizzes, research, journal articles, presentations, and career guidance. Student accounts, chat history, course materials, quiz progress, and generated documents are stored privately with Supabase.

## Set up Supabase

1. Create a Supabase project.
2. Copy `.env.example` to `.env.local` and set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` from the project API settings. Add the Groq and Google AI keys for the providers you use. `TAVILY_API_KEY` enables web search.
3. Apply every SQL file in `supabase/migrations` in timestamp order in the Supabase SQL editor or through the Supabase CLI. These create the student profile, private storage, presentations, and profile onboarding schema.
4. In Supabase Auth settings, configure the local and deployed site URLs and add `/auth/callback` to the allowed redirect URLs. Enable Google under Auth providers and configure its OAuth credentials to offer Google sign-in.

The migration creates the profile, chat, message, material, quiz, and artifact tables with row-level security. It also creates a private `student-files` bucket. Do not put service-role keys in browser-visible environment variables.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), create a student account, and sign in. Uploaded files are limited to 10 MB each and supported formats are PNG/JPG, TXT, PDF, and DOCX. Images are interpreted with Gemini; the image-analysis path requires `GOOGLE_GENERATIVE_AI_API_KEY`.

Word and PDF files are generated only after the student explicitly requests one in chat. The resulting file is saved in the student's private storage and can be downloaded from the conversation.
