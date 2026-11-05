# Contributing from Fork - Quick Guide

## Overview

You are contributing from your fork to the upstream repository:

```
YOUR FORK                           UPSTREAM REPOSITORY
morelucks/Joint_Save    ────→      JointSave-org/Joint_Save
(feature branch)                    (main branch + issue #263)
```

## Current Status

✅ **Your Fork**: `morelucks/Joint_Save`  
✅ **Upstream**: `JointSave-org/Joint_Save`  
✅ **Branch**: `feature/admin-emergency-controls-263`  
✅ **Commits**: 5 commits ready  
✅ **Issue to Close**: `JointSave-org/Joint_Save#263`  
✅ **Author**: `morelucks <luckykamshak@gmail.com>`  

## Three Ways to Create the PR

### ⭐ Option 1: Use the Helper Script (Recommended)

This is the easiest way:

```bash
./create-pr.sh
```

The script will:
1. ✅ Verify you're on the correct branch
2. ✅ Authenticate with GitHub (if needed)
3. ✅ Push to your fork (`morelucks/Joint_Save`)
4. ✅ Create PR to upstream (`JointSave-org/Joint_Save`)
5. ✅ Add all required labels
6. ✅ Reference issue #263 (will auto-close on merge)

---

### Option 2: Manual Commands

If you prefer manual control:

```bash
# 1. Authenticate with GitHub
gh auth login

# 2. Push to your fork
git push -u origin feature/admin-emergency-controls-263

# 3. Create PR to upstream
gh pr create \
  --repo JointSave-org/Joint_Save \
  --title "feat: Admin emergency controls with SEP-53 signature proof" \
  --body-file .github/pr-description.md \
  --label "smart-contract" \
  --label "frontend" \
  --label "feature" \
  --label "priority: high" \
  --label "high-complexity" \
  --assignee morelucks \
  --head morelucks:feature/admin-emergency-controls-263 \
  --base main
```

**Important**: Notice `--head morelucks:feature-admin-emergency-controls-263` - this tells GitHub the PR is coming from your fork.

---

### Option 3: Via GitHub Web UI

Perfect if you prefer a visual interface:

#### Step 1: Push to Your Fork
```bash
git push -u origin feature/admin-emergency-controls-263
```

#### Step 2: Navigate to GitHub
Go to either:
- **Your fork**: https://github.com/morelucks/Joint_Save
- **Upstream**: https://github.com/JointSave-org/Joint_Save

You'll see a yellow banner: **"Compare & pull request"**

#### Step 3: Create the PR
1. Click **"Compare & pull request"**
2. **IMPORTANT**: Ensure the base repository is set to:
   ```
   base repository: JointSave-org/Joint_Save
   base: main
   ```
3. And head repository should be:
   ```
   head repository: morelucks/Joint_Save
   compare: feature/admin-emergency-controls-263
   ```
4. **Title**: 
   ```
   feat: Admin emergency controls with SEP-53 signature proof
   ```
5. **Description**: Copy the entire content from `.github/pr-description.md`
6. **Labels**: Add these labels:
   - `smart-contract`
   - `frontend`
   - `feature`
   - `priority: high`
   - `high-complexity`
7. **Assignee**: Select `morelucks`
8. **Important**: Verify the description includes `Fixes JointSave-org/Joint_Save#263` (this auto-closes the issue)
9. Click **"Create pull request"**

---

## Verification Checklist

Before creating the PR, verify:

- [ ] You're on branch `feature/admin-emergency-controls-263`
- [ ] All 5 commits are present
- [ ] Git author is `morelucks <luckykamshak@gmail.com>`
- [ ] Remote `origin` points to your fork (`morelucks/Joint_Save`)
- [ ] Remote `upstream` points to main repo (`JointSave-org/Joint_Save`)
- [ ] No uncommitted changes

Run this to verify:
```bash
git status
git log --oneline -5
git remote -v
```

Expected output:
```
On branch feature/admin-emergency-controls-263
origin  https://github.com/morelucks/Joint_Save (fetch)
upstream https://github.com/JointSave-org/Joint_Save.git (fetch)
```

---

## What Happens After PR Creation?

1. **Issue #263 gets linked**: The PR will show "Fixes #263" badge
2. **CI/CD runs**: GitHub Actions will run tests and checks
3. **Maintainer review**: JointSave maintainers will review your code
4. **Feedback loop**: You may need to make changes based on feedback
5. **Merge**: Once approved, maintainers merge the PR
6. **Issue closes**: Issue #263 automatically closes when PR merges
7. **Your contribution**: Shows in the repository's contributor graph! 🎉

---

## Making Changes After PR Creation

If maintainers request changes:

```bash
# Make your changes to the files
git add -A
git commit -m "fix: address review feedback"
git push origin feature/admin-emergency-controls-263
```

The PR will automatically update with your new commits!

---

## Troubleshooting

### "Permission denied" when pushing
**Problem**: You might not be authenticated  
**Solution**: Run `gh auth login` or set up SSH keys

### "No such remote 'upstream'"
**Problem**: Upstream remote not added  
**Solution**: 
```bash
git remote add upstream https://github.com/JointSave-org/Joint_Save.git
```

### PR created to wrong repository
**Problem**: PR went to your fork instead of upstream  
**Solution**: Close that PR and recreate with `--repo JointSave-org/Joint_Save`

### Labels not showing up
**Problem**: You might not have permission to add labels  
**Solution**: That's okay! Maintainers will add them when they see the PR

---

## Summary of Your Contribution

This PR implements **Issue #263** with the following features:

✅ Admin emergency controls (pause/resume/emergency_withdraw)  
✅ SEP-53 wallet signature proof  
✅ Rate limiting and security hardening  
✅ Full UI components with EN + ES translations  
✅ Comprehensive tests and documentation  

**Total Impact**:
- 9 files created
- 4 files modified
- ~1,900 lines of code
- 12 unit tests
- Full security audit trail

---

## Ready? Let's Go! 🚀

Choose your preferred method above and create that PR!

**Recommended**: Just run `./create-pr.sh` and let it handle everything.

After the PR is created, you can find it at:
https://github.com/JointSave-org/Joint_Save/pulls

---

## Need Help?

- **PR Description**: See `.github/pr-description.md`
- **Implementation Details**: See `docs/ADMIN_EMERGENCY_CONTROLS.md`
- **Full Checklist**: See `FINAL_CHECKLIST.md`

Good luck with your contribution! 🌟
