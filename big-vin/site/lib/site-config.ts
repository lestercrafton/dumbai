type DataSource = {
  name: string;
  description: string;
  href: string;
};

type SiteConfig = {
  name: string;
  tagline: string;
  pledge: string;
  ambassadors: string;
  donation: {cashtag: string; href: string; qrImage: string};
  dataSources: DataSource[];
};

/** Public copy and source links; operating costs require audited billing data. */
export const SITE_CONFIG: SiteConfig = {
  name: 'Big Vin',
  tagline: 'Grind to Win',
  donation: {
    cashtag: '$bigvinsports',
    href: 'https://cash.app/$bigvinsports',
    qrImage: '/cash-app-bigvinsports.png',
  },
  pledge:
    '50/50. Everything we earn above what it costs to run this site gets split down the middle. Half goes to the owners and creators. Half goes into more data and better models, to build a line better than Vegas, so everyone wins together.',
  ambassadors: 'Grateful to our college ambassadors for working with us to build the knowledge we need to finally beat Vegas.',
  dataSources: [
    {
      name: 'ESPN · NFL',
      description: 'Public scoreboards: schedules, scores, and sportsbook lines.',
      href: 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?limit=1000',
    },
    {
      name: 'ESPN · College football',
      description:
        'Public scoreboards and saved finals used for college team ratings.',
      href: 'https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?limit=200&groups=80',
    },
    {
      name: 'nflverse / nfldata',
      description: 'NFL game history, final scores, venues, and rest days.',
      href: 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv',
    },
  ],
};
