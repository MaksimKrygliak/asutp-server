import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  service: "Gmail",
  auth: {
    user: "asutpdigital@gmail.com",
    pass: "vygn nfxc utko pjkn",
  },
});
export default transporter;