import express from "express";
import cors from "cors";
import userRoutes from "./routes/user.routes.js";
import authRoutes from "./routes/auth.routes.js";
import assetRoutes from "./routes/asset.routes.js";
import securityRoutes from "./routes/security.routes.js";
import siteRoutes from './routes/site.routes.js';
import { errorHandler } from "./middlewares/error.middleware.js";
import dashboardRoutes from './routes/dashboard.routes.js';
import companyRoutes from './routes/company.routes.js';

const app = express();

const corsOptions = {
    origin: [
        "http://localhost:5173",
        "http://localhost:8080",   // 🔥 ADD THIS
        "https://inventory.kdmengineers.com"
    ],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));



// app.use(cors());
// app.options("*", cors());



app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static("uploads"));
app.use("/api/security", securityRoutes);
app.use("/api/users", userRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/assets", assetRoutes);
app.use("/api/sites", siteRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/companies", companyRoutes);



app.use(errorHandler);

export default app;
