#!/bin/bash

# Helper script to push branch and create PR from fork to upstream
# Fork: morelucks/Joint_Save → Upstream: JointSave-org/Joint_Save
# Issue: JointSave-org/Joint_Save#263
# Author: morelucks <luckykamshak@gmail.com>

set -e  # Exit on error

echo "=================================================="
echo "  🚀 Push & Create PR from Fork to Upstream"
echo "=================================================="
echo ""
echo "Fork:     morelucks/Joint_Save"
echo "Upstream: JointSave-org/Joint_Save"
echo "Issue:    #263"
echo ""

# Check if we're on the right branch
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "feature/admin-emergency-controls-263" ]; then
    echo "❌ Error: Not on the correct branch"
    echo "Current branch: $CURRENT_BRANCH"
    echo "Expected: feature/admin-emergency-controls-263"
    exit 1
fi

echo "✅ On correct branch: $CURRENT_BRANCH"
echo ""

# Check if gh CLI is installed
if ! command -v gh &> /dev/null; then
    echo "❌ GitHub CLI (gh) is not installed"
    echo ""
    echo "Please install it:"
    echo "  macOS:   brew install gh"
    echo "  Linux:   https://cli.github.com/manual/installation"
    echo "  Windows: https://cli.github.com/manual/installation"
    echo ""
    echo "Or create the PR manually via GitHub web UI"
    exit 1
fi

# Check if authenticated
if ! gh auth status &> /dev/null; then
    echo "⚠️  Not authenticated with GitHub"
    echo "Running authentication..."
    gh auth login
fi

echo "✅ Authenticated with GitHub"
echo ""

# Push to fork (origin)
echo "📤 Pushing branch to fork (morelucks/Joint_Save)..."
git push -u origin feature/admin-emergency-controls-263

echo ""
echo "✅ Branch pushed to fork successfully!"
echo ""

# Create PR to upstream
echo "📝 Creating Pull Request to upstream (JointSave-org/Joint_Save)..."
echo ""
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

echo ""
echo "=================================================="
echo "  ✅ SUCCESS!"
echo "=================================================="
echo ""
echo "✓ Branch pushed to fork: morelucks/Joint_Save"
echo "✓ PR created to upstream: JointSave-org/Joint_Save"
echo "✓ PR will close issue #263 when merged"
echo ""
echo "Next steps:"
echo "  1. Review the PR on GitHub"
echo "  2. Respond to maintainer feedback"
echo "  3. Wait for approval and merge"
echo ""
echo "View your PR:"
echo "  https://github.com/JointSave-org/Joint_Save/pulls"
echo ""
