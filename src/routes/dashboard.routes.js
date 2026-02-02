import express from "express";
import { authenticate } from "../middlewares/auth.middleware.js";
const router = express.Router();
import { getDashboardData } from "../controllers/dashboard.controller.js";

router.get("/:adminId", authenticate, getDashboardData);

export default router;