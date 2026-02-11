import express from "express";
import { authenticate } from "../middlewares/auth.middleware.js";
import { createSite, getAllSites, deleteSite, getSiteById, updateSite } from "../controllers/site.controller.js";
const router = express.Router();


router.post("/create", authenticate, createSite);
router.get("/all-sites", authenticate, getAllSites);
router.delete("/delete/:id", authenticate, deleteSite);
router.get("/:id", authenticate, getSiteById);
router.put("/update/:id", authenticate, updateSite);



export default router;

