import { createServer } from "node:http";
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
// src/tp.ts
const port = Number(process.env["PORT"] ?? 3e3);
const hostname = "0.0.0.0";
mkdirSync("data", { recursive: true });
const database = new DatabaseSync("data/notes.db");
database.exec(`
  CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    author TEXT NOT NULL,
    rating INTEGER NOT NULL,
    done INTEGER NOT NULL CHECK (done IN (0, 1)),
    created_at TEXT NOT NULL
  )
`);
const sendJson = (response, statusCode, body, headers = {}) => {
	response.writeHead(statusCode, {
		"Content-Type": "application/json; charset=utf-8",
		...headers
	});
	response.end(JSON.stringify(body));
};
const readBody = async (request) => {
	let body = "";
	for await (const chunk of request) body += chunk.toString();
	return body;
};
const toNote = (row) => ({
	id: row.id,
	title: row.title,
	author: row.author,
	rating: row.rating,
	done: row.done === 1,
	createdAt: row.created_at
});
const validateNote = (value) => {
	const errors = {};
	if (typeof value !== "object" || value === null || Array.isArray(value)) return { errors: { body: "must be a JSON object" } };
	const body = value;
	const title = body["title"];
	const author = body["author"];
	const rating = body["rating"];
	const done = body["done"] ?? false;
	if (typeof title !== "string" || title.trim().length === 0) errors["title"] = "is required and must be non-empty";
	else if (title.length > 100) errors["title"] = "must be at most 100 characters";
	if (typeof author !== "string" || author.trim().length === 0) errors["author"] = "is required and must be non-empty";
	if (typeof rating !== "number" || !Number.isInteger(rating) || rating < 1 || rating > 5) errors["rating"] = "must be an integer from 1 to 5";
	if (typeof done !== "boolean") errors["done"] = "must be a boolean";
	if (Object.keys(errors).length > 0) return { errors };
	return {
		errors,
		input: {
			title,
			author,
			rating,
			done
		}
	};
};
const createNote = (input) => {
	const note = {
		id: randomUUID(),
		title: input.title,
		author: input.author,
		rating: input.rating,
		done: input.done,
		createdAt: (/* @__PURE__ */ new Date()).toISOString()
	};
	database.exec("BEGIN");
	try {
		database.prepare(`INSERT INTO notes (id, title, author, rating, done, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`).run(note.id, note.title, note.author, note.rating, note.done ? 1 : 0, note.createdAt);
		database.exec("COMMIT");
	} catch (error) {
		database.exec("ROLLBACK");
		throw error;
	}
	return note;
};
const getNotes = (query) => {
	const author = query.get("author");
	const done = query.get("done");
	const min = query.get("min");
	if (done !== null && done !== "true" && done !== "false") throw new HttpError(400, "done must be true or false");
	let minimumRating;
	if (min !== null) {
		minimumRating = Number(min);
		if (!/^[1-5]$/.test(min) || !Number.isInteger(minimumRating)) throw new HttpError(400, "min must be an integer from 1 to 5");
	}
	const conditions = [];
	const parameters = [];
	if (author !== null) {
		conditions.push("LOWER(author) = LOWER(?)");
		parameters.push(author);
	}
	if (done !== null) {
		conditions.push("done = ?");
		parameters.push(done === "true" ? 1 : 0);
	}
	if (minimumRating !== void 0) {
		conditions.push("rating >= ?");
		parameters.push(minimumRating);
	}
	const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
	return database.prepare(`SELECT id, title, author, rating, done, created_at
       FROM notes ${where}
       ORDER BY created_at DESC, title ASC`).all(...parameters).map(toNote);
};
var HttpError = class extends Error {
	statusCode;
	constructor(statusCode, message) {
		super(message);
		this.statusCode = statusCode;
	}
};
const getNote = (id) => {
	const row = database.prepare(`SELECT id, title, author, rating, done, created_at
       FROM notes WHERE id = ?`).get(id);
	return row === void 0 ? void 0 : toNote(row);
};
const deleteNote = (id) => {
	database.exec("BEGIN");
	try {
		const result = database.prepare("DELETE FROM notes WHERE id = ?").run(id);
		database.exec("COMMIT");
		return result.changes > 0;
	} catch (error) {
		database.exec("ROLLBACK");
		throw error;
	}
};
const route = async (request, response) => {
	const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
	const notePath = url.pathname.match(/^\/notes\/([^/]+)$/);
	if (url.pathname === "/health" && request.method === "GET") {
		const row = database.prepare("SELECT COUNT(*) AS count FROM notes").get();
		sendJson(response, 200, {
			status: "ok",
			notes: row.count
		});
		return;
	}
	if (url.pathname === "/notes" && request.method === "GET") {
		sendJson(response, 200, getNotes(url.searchParams));
		return;
	}
	if (url.pathname === "/notes" && request.method === "POST") {
		let body;
		try {
			body = JSON.parse(await readBody(request));
		} catch {
			sendJson(response, 422, { errors: { body: "must be valid JSON" } });
			return;
		}
		const validation = validateNote(body);
		if (validation.input === void 0) {
			sendJson(response, 422, { errors: validation.errors });
			return;
		}
		const note = createNote(validation.input);
		sendJson(response, 201, note, { Location: `/notes/${note.id}` });
		return;
	}
	if (notePath !== null && request.method === "GET") {
		const id = notePath[1];
		if (id === void 0) {
			sendJson(response, 404, { error: "Not found" });
			return;
		}
		const note = getNote(decodeURIComponent(id));
		if (note === void 0) {
			sendJson(response, 404, { error: "Not found" });
			return;
		}
		sendJson(response, 200, note);
		return;
	}
	if (notePath !== null && request.method === "DELETE") {
		const id = notePath[1];
		if (id === void 0 || !deleteNote(decodeURIComponent(id))) {
			sendJson(response, 404, { error: "Not found" });
			return;
		}
		response.writeHead(204);
		response.end();
		return;
	}
	sendJson(response, 404, { error: "Not found" });
};
const server = createServer((request, response) => {
	route(request, response).catch((error) => {
		if (error instanceof HttpError) {
			sendJson(response, error.statusCode, { error: error.message });
			return;
		}
		console.error(error);
		if (!response.headersSent) sendJson(response, 500, { error: "Internal server error" });
		else response.destroy();
	});
});
const shutdown = () => {
	server.close(() => {
		database.close();
		process.exit(0);
	});
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
server.listen(port, hostname, () => {
	console.log(`Http server listening on http://${hostname}:${port}`);
});
export {};
