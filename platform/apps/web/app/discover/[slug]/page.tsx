import ProjectDetail from './project-detail';
export default async function ProjectPage({params}:{params:Promise<{slug:string}>}) {
  const {slug}=await params;return <ProjectDetail slug={slug}/>;
}
