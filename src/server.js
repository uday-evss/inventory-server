// import app from "./app.js";
// import sequelize from "./config/database.js";

// const PORT = process.env.PORT || 5000;

// (async () => {
//     try {
//         await sequelize.authenticate();
//         // await sequelize.sync({ alter: true });
//         await sequelize.sync();
//         console.log("✅ Database connected");

//         app.listen(PORT, () =>
//             console.log(`🚀 Server running on port ${PORT}`)
//         );
//     } catch (error) {
//         console.error("❌ DB Connection Failed", error);
//     }
// })();



import app from "./app.js";
import sequelize from "./config/database.js";

const PORT = process.env.PORT || 8000;

// 🔥 Start server immediately
app.listen(PORT, async () => {
    console.log(`🚀 Server running on port ${PORT}`);

    try {
        await sequelize.authenticate();
        await sequelize.sync();
        console.log("✅ Database connected");
    } catch (error) {
        console.error("❌ Database connection failed:", error.message);
    }
});
