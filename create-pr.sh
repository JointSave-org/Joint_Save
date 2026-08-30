#!/bin/bash

# Helper script to push branch and create PR for issue #263
# Author: morelucks <luckykamshak@gmail.com>

set -e  # Exit on error

echo "=================================="
echo "  Push & Create PR - Issue #263"
echo "=================================="
echo ""

# Check if we're on the right branch
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "feature/admin-emergency-controls-263" ]; then
    echo "❌ Error: Not on the correct branch"
    echo "Current branch: $CURRENT_BRANCH"
    echo "Expected: feature/admin-emergency-controls-263"
    exit 1
fi

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

# Push the branch
echo "📤 Pushing branch to origin..."
git push -u origin feature/admin-emergency-controls-263

echo ""
echo "✅ Branch pushed successfully!"
echo ""

# Create the PR
echo "📝 Creating Pull Request..."
gh pr create \
  --repo JointSave-org/Joint_Save \
  --title "feat: Admin emergency controls with SEP-53 signature proof" \
  --body-file .github/pr-description.md \
  --label "smart-contract,frontend,feature,priority: high,high-complexity" \
  --assignee morelucks \
  --head morelucks:feature/admin-emergency-controls-263 \
  --base main

echo ""
echo "=================================="
echo "  ✅ SUCCESS!"
echo "=================================="
echo ""
echo "The PR has been created and will automatically close issue #263 when merged."
echo ""
echo "Next steps:"
echo "  1. Review the PR on GitHub"
echo "  2. Address any CI/CD check failures"
echo "  3. Wait for maintainer review"
echo "  4. Make requested changes if needed"
echo ""
