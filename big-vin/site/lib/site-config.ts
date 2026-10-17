type DataSource = {
  name: string;
  description: string;
  href: string;
};

type SiteConfig = {
  name: string;
  tagline: string;
  pledge: string;
  profitAllocation: {percent: number; label: string; description: string}[];
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
    'First, we pay the fees to keep the lights on. Then we split the remaining profit: 50% goes into more data and compute to create better models, 25% goes to Big Vin’s Big Men on Campus, and 25% goes to the founder who created the original algorithm during COVID.',
  profitAllocation: [
    {percent: 50, label: 'DATA + COMPUTE', description: 'Invest half the profit into more data and compute to create better models.'},
    {percent: 25, label: 'BIG MEN ON CAMPUS', description: 'Support Big Vin’s Big Men on Campus, giving the next generation of future-predictors an edge—if one can be found.'},
    {percent: 25, label: 'THE FOUNDER', description: 'Go to the founder for creating the original algorithm during COVID.'},
  ],
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
