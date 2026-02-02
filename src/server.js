import app from "./app.js";
import sequelize from "./config/database.js";

const PORT = process.env.PORT || 5000;

(async () => {
    try {
        await sequelize.authenticate();
        // await sequelize.sync({ alter: true });
         await sequelize.sync();
        console.log("✅ Database connected");

        app.listen(PORT, () =>
            console.log(`🚀 Server running on port ${PORT}`)
        );
    } catch (error) {
        console.error("❌ DB Connection Failed", error);
    }
})();

