# REGN Labs store

The whole site is `index.html`. The admin panel lives at `/#admin`.

## Put it online with GitHub Pages
1. Upload everything in this folder to this repository (Add file → Upload files).
2. Go to **Settings → Pages**. Under "Build and deployment", choose **Deploy from a branch**,
   pick **main** and **/ (root)**, and click Save.
3. After a minute the site is live at `https://<your-username>.github.io/<repo-name>/`.
   To use your own domain, enter it under Settings → Pages → Custom domain and turn on
   **Enforce HTTPS**.

## Connect the admin (once per device)
1. Create a token: GitHub → your profile picture → **Settings → Developer settings →
   Personal access tokens → Fine-grained tokens → Generate new token**.
   - Repository access: **Only select repositories** → this repository
   - Permissions → Repository permissions → **Contents: Read and write**
2. Open `your-site/#admin`, paste the token, and choose an admin password.
   The repository name fills in automatically on github.io addresses.

After that, sign in with just your password. Changes publish a few seconds after you
stop editing (or click **Publish now**) and go live when GitHub finishes deploying,
usually within a minute. Images and COAs are saved into the `uploads/` folder here.

Every change is a commit, so you can undo anything from the repository's history.
