import express from "express";
import { authenticate } from "../middlewares/auth.middleware.js";
import { createSite, getAllSites, deleteSite, getSiteById, updateSite } from "../controllers/site.controller.js";
const router = express.Router();


router.post("/create", authenticate, createSite);
router.get("/all-sites", authenticate, getAllSites);
router.delete("/delete/:id", authenticate, deleteSite);
router.get("/:id", getSiteById);
router.put("/update/:id", updateSite);



export default router;

