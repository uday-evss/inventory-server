import express from "express";
import { authenticate } from "../middlewares/auth.middleware.js";
import { getCompanyById } from "../controllers/company.controller.js";

const router = express.Router();

// fetch company using company_id
router.get("/:id", authenticate, getCompanyById);

export default router;
