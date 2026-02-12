import express from "express";
import { loginUser, forgotPassword } from "../controllers/auth.controller.js";

const router = express.Router();
console.log('trigerred')
router.post("/login", loginUser);
router.post("/forgot-password", forgotPassword);
export default router;
