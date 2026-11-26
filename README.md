# AI and Machine Learning Exam: Flask + PostgreSQL on alwaysdata, React on Vercel

## 1. Backend on alwaysdata
1. In the alwaysdata panel, create a PostgreSQL database and a database user. Note the host, database name, user and password.
2. Upload the `backend` folder (SFTP or Git), for example to `~/exam/backend`.
3. Over SSH, create a virtualenv and install: `python -m venv ~/exam/venv && ~/exam/venv/bin/pip install -r ~/exam/backend/requirements.txt`
4. In Web > Sites, add a site of type Python WSGI. Application path: `exam/backend/wsgi.py`, variable `application`, and select the virtualenv above.
5. In the site's environment variables, set the four values from `backend/.env.example`:
   `DATABASE_URL`, `TEACHER_PASSWORD`, `EXAM_CODE`, `FRONTEND_ORIGIN` (your Vercel URL, with no trailing slash).
6. Restart the site and open `https://YOUR-ACCOUNT.alwaysdata.net/api/health`. You should see `{"ok":true}`. Tables are created automatically on first start.

## 2. Frontend on Vercel
1. Push the `frontend` folder to GitHub and import it in Vercel (framework: Vite).
2. Add the environment variable `VITE_API_URL` = your alwaysdata URL (no trailing slash).
3. Deploy. Then set `FRONTEND_ORIGIN` on alwaysdata to the final Vercel URL and restart the backend.

## 3. Running the exam
- Students open the Vercel URL, enter name, admission number and the exam code you give them in class.
- You mark at `https://YOUR-VERCEL-URL/#/teacher` with `TEACHER_PASSWORD`. Section A is already marked. Choose 0, 1 or 2 for each written answer, press Save marks, then Download CSV.
- Edit `backend/questions.json` to change questions or the duration (`duration_minutes`), then restart the site.

## Notes
- The timer is kept on the server. Refreshing the page does not reset it. Answers autosave and are marked closed when time runs out.
- Each admission number gets one attempt. A student who refreshes or reconnects with the same name and admission number resumes their attempt.
- Test locally first: `cd backend && pip install -r requirements.txt && TEACHER_PASSWORD=x flask --app app run`, then `cd frontend && npm install && npm run dev`.
