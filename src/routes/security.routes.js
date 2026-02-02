import express from "express";
import { changePassword } from "../controllers/security.controller.js";
import { authenticate } from "../middlewares/auth.middleware.js";

const router = express.Router();

router.put("/change-password", authenticate, changePassword);

export default router;
