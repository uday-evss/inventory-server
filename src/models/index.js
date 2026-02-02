import sequelize from "../config/database.js";
import User from "./User.model.js";
import Asset from "./Asset.model.js";
import AssetDocument from "./AssetDocument.model.js";
import AssetRequest from "./AssetRequest.model.js";
import AssetRequestItem from "./AssetRequestItem.model.js";
import AssetRequestItemImage from "./AssetRequestItemImage.model.js";
import SiteData from "./SiteData.model.js";
import AssetReturnRequest from './AssetReturnRequest.model.js';
import AssetReturnItem from './AssetReturnItem.model.js';
import AssetReturnImage from './AssetReturnImage.model.js'


const db = {};

db.sequelize = sequelize;
db.User = User;
db.Asset = Asset;
db.AssetDocument = AssetDocument;
db.AssetRequest = AssetRequest;
db.AssetRequestItem = AssetRequestItem;
db.AssetRequestItemImage = AssetRequestItemImage;
db.SiteData = SiteData;
db.AssetReturnRequest = AssetReturnRequest;
db.AssetReturnItem = AssetReturnItem;
db.AssetReturnImage = AssetReturnImage;

/* ================= INITIALIZE ASSOCIATIONS ================= */
Object.values(db).forEach((model) => {
    if (model?.associate) {
        model.associate(db);
    }
});

export default db;
