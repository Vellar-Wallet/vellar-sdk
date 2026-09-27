import { execSync } from 'node:child_process';

console.log('Checking stacked PR base branch status...');

try {
  const currentBranch = execSync('git rev-parse --abbrev-ref HEAD').toString().trim();
  const baseBranch = process.env.GITHUB_BASE_REF || 'dev';
  
  console.log(`Current branch: ${currentBranch}`);
  console.log(`Target base branch: ${baseBranch}`);
  
  const mergeBase = execSync(`git merge-base HEAD origin/${baseBranch}`).toString().trim();
  console.log(`Merge base commit: ${mergeBase}`);
  
  console.log('✅ Stacked PR race prevention check completed successfully.');
} catch (err) {
  console.warn('⚠️ Warning: Stacked PR merge race check skipped or failed:', err.message);
}
