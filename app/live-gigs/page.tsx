"use client";

import AdminLayout from "@/components/layout/AdminLayout";
import { collection, getDocs, query, where } from "firebase/firestore";
import { useEffect, useState } from "react";
import { db } from "@/lib/firebase";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/shadcn-ui/card";
import { Badge } from "@/components/shadcn-ui/badge";
import { Briefcase } from "lucide-react";
import { useAuthGuard } from "@/hooks/useAuthGuard";

interface Application {
  id: string;
  gigId: string;
  gigOwnerId: string;
  userId: string;
  applicantName: string;
  status: string;
  applied: boolean;
  appliedAt: any;
  [key: string]: any;
}

interface Gig {
  id: string;
  applications: Application[];
  [key: string]: any;
}

export default function LiveGigsPage() {
  useAuthGuard({ module: "live-gigs" });
  const [liveGigs, setLiveGigs] = useState<Gig[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchLiveGigs();
  }, []);

  const fetchLiveGigs = async () => {
    setLoading(true);
    try {
      const gigsSnapshot = await getDocs(collection(db, "gigs"));
      const gigs = gigsSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

      const gigsWithApplications = await Promise.all(
        gigs.map(async (gig) => {
          const appsSnapshot = await getDocs(
            query(collection(db, "applications"), where("gigId", "==", gig.id))
          );
          const applications = appsSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Application));

          const applicationsWithUsers = await Promise.all(
            applications.map(async (app) => {
              const userSnapshot = await getDocs(
                query(collection(db, "users"), where("uid", "==", app.userId))
              );
              const user = userSnapshot.docs[0]?.data() ?? null;
              return {
                ...app,
                applicantName: user?.name ?? user?.displayName ?? "Unknown",
              };
            })
          );

          return { ...gig, applications: applicationsWithUsers };
        })
      );

      setLiveGigs(gigsWithApplications);
    } catch (error) {
      console.error("Failed to fetch gigs:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AdminLayout
      title="Live Gigs"
      subtitle="Monitor and manage all active gig postings"
    >
      <div>
        {loading ? (
          <p>Loading...</p>
        ) : (
          liveGigs.map((gig) => (
            <div key={gig.id} className="mb-4">
              <Card className="border-gray-800">
                <CardHeader>
                  <CardTitle>
                    <div className="flex items-center gap-2 text-xl">
                      <Briefcase />
                      {gig.title}
                    </div>
                  </CardTitle>
                  <CardAction>
                    {gig.status === "available" ? (
                      <Badge className="bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300">
                        Available
                      </Badge>
                    ) : (
                      <Badge className="bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300">
                        Not Available
                      </Badge>
                    )}
                  </CardAction>
                  <CardDescription>
                    <div>
                      <Badge variant="outline">{gig.postedBy}</Badge>
                    </div>
                  </CardDescription>
                </CardHeader>

                <CardContent>
                  <div className="flex flex-col gap-2">
                    <p>Description: {gig.description}</p>
                    <p>Posted last: {gig.createdAt?.toDate().toLocaleString()}</p>
                    <hr className="my-2 border-gray-700" />
                    <div>
                      <div className="text-md text-gray-500">Gig Status</div>
                      <div className="flex gap-4 items-center my-2">
                        <Badge className="bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                          {gig.category}
                        </Badge>
                        <Badge className="bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300">
                          {`${gig.vacancy} ${gig.vacancy > 1 ? "Vacancies" : "Vacancy"}`}
                        </Badge>
                        <Badge className="bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300">
                          {`${gig.slot} ${gig.slot > 1 ? "Slots" : "Slot"}`}
                        </Badge>
                      </div>
                    </div>
                  </div>
                </CardContent>

                <CardFooter>
                  <div className="w-full">
                    <div className="text-md text-gray-500 mb-2">
                      Applicants ({gig.applications?.length ?? 0})
                    </div>
                    {gig.applications?.length === 0 ? (
                      <p className="text-gray-500 text-sm">No applicants yet</p>
                    ) : (
                      <div className="flex flex-col gap-2">
                        {gig.applications?.map((app: Application) => (
                          <div key={app.id} className="flex items-center justify-between">
                            <span className="text-sm">{app.applicantName}</span>
                            <Badge
                              className={
                                app.status === "accepted"
                                  ? "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300"
                                  : app.status === "rejected"
                                  ? "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"
                                  : "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                              }
                            >
                              {app.status}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </CardFooter>
              </Card>
            </div>
          ))
        )}
      </div>
    </AdminLayout>
  );
}