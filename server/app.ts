import express from "express";
import checkInRouter from "./routes/check-in.js";

export const app = express();
app.use(express.json());
app.use("/api", checkInRouter);
