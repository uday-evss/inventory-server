import { DataTypes } from "sequelize";
import sequelize from "../config/database.js";

const AssetRequestItemImage = sequelize.define(
    "AssetRequestItemImage",
    {
        id: {
            type: DataTypes.CHAR(36),
            primaryKey: true,
            defaultValue: DataTypes.UUIDV4,
        },

        request_item_id: {
            type: DataTypes.CHAR(36),
            allowNull: false,
        },


        image_url: {
            type: DataTypes.STRING,
            allowNull: false,
        },

        usage_qty: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0,
        },

        asset_condition: {
            type: DataTypes.STRING,
            allowNull: true, // change to false if mandatory
        },

        uploaded_by: {
            type: DataTypes.CHAR(36),
            allowNull: false,
        },

    },
    {
        tableName: "asset_request_item_images",
        timestamps: true,
        createdAt: "uploaded_at",
        updatedAt: false,
        charset: "utf8mb4",
        collate: "utf8mb4_bin",
    }
);

/* ================= ASSOCIATIONS ================= */
AssetRequestItemImage.associate = (models) => {
    AssetRequestItemImage.belongsTo(models.AssetRequestItem, {
        foreignKey: "request_item_id",
        as: "requestItem",
        onDelete: "CASCADE",
    });

    AssetRequestItemImage.belongsTo(models.User, {
        foreignKey: "uploaded_by",
        as: "uploadedBy",
    });

};

export default AssetRequestItemImage;
