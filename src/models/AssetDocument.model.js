import { DataTypes } from "sequelize";
import sequelize from "../config/database.js";

const AssetDocument = sequelize.define(
    "AssetDocument",
    {
        id: {
            type: DataTypes.CHAR(36),
            primaryKey: true,
            defaultValue: DataTypes.UUIDV4,
        },

        asset_id: {
            type: DataTypes.CHAR(36),
            allowNull: false,
        },

        document_url: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        doc_type: {
            type: DataTypes.ENUM(
                "warranty",
                "technical_data_sheet",
                "calibration_certificate"
            ),
            allowNull: false,
        }

    },
    {
        tableName: "asset_documents",
        timestamps: true,
        charset: "utf8mb4",
        collate: "utf8mb4_bin",
    }
);

/* ================= ASSOCIATIONS ================= */
AssetDocument.associate = (models) => {
    AssetDocument.belongsTo(models.Asset, {
        foreignKey: "asset_id",
        as: "asset",
    });
};

export default AssetDocument;
