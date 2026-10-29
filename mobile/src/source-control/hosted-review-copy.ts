import { translate } from '../i18n/mobile-i18n'

// Use the desktop provider vocabulary: GitLab says Merge Request.
export type HostedReviewCopy = {
  shortLabel: string
  reviewLabel: string
  titleLabel: string
}

function prCopy(): HostedReviewCopy {
  return {
    shortLabel: translate('sourceControl.hostedReview.prCopy.shortLabel', 'PR'),
    reviewLabel: translate('sourceControl.hostedReview.prCopy.reviewLabel', 'pull request'),
    titleLabel: translate('sourceControl.hostedReview.prCopy.titleLabel', 'Pull Request')
  }
}

function mrCopy(): HostedReviewCopy {
  return {
    shortLabel: translate('sourceControl.hostedReview.mrCopy.shortLabel', 'MR'),
    reviewLabel: translate('sourceControl.hostedReview.mrCopy.reviewLabel', 'merge request'),
    titleLabel: translate('sourceControl.hostedReview.mrCopy.titleLabel', 'Merge Request')
  }
}

export function hostedReviewCopy(provider: string | undefined): HostedReviewCopy {
  return provider === 'gitlab' ? mrCopy() : prCopy()
}
